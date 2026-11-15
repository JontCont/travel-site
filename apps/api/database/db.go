package database

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"travel-api/models"

	_ "modernc.org/sqlite"
)

type DB struct {
	db *sql.DB
	mu sync.RWMutex
}

func Open(databasePath string) (*DB, error) {
	cleanPath := filepath.Clean(databasePath)
	if err := os.MkdirAll(filepath.Dir(cleanPath), 0755); err != nil {
		return nil, fmt.Errorf("failed to create db directory: %w", err)
	}

	sqlDB, err := sql.Open("sqlite", cleanPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite database: %w", err)
	}

	// Single connection for SQLite to avoid lock issues
	sqlDB.SetMaxOpenConns(1)

	d := &DB{db: sqlDB}
	if err := d.migrate(); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("database migration failed: %w", err)
	}

	return d, nil
}

func (d *DB) Close() error {
	return d.db.Close()
}

func (d *DB) migrate() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	// 1. Workspace
	_, err := d.db.Exec(`CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id = 1), data_json TEXT NOT NULL)`)
	if err != nil {
		return err
	}

	// 2. Auth sessions migration
	var hasCredentialHash bool
	rows, err := d.db.Query("PRAGMA table_info(auth_sessions)")
	if err == nil {
		for rows.Next() {
			var cid int
			var name, colType string
			var notnull, pk int
			var dfltValue interface{}
			if err := rows.Scan(&cid, &name, &colType, &notnull, &dfltValue, &pk); err == nil {
				if name == "credential_hash" {
					hasCredentialHash = true
				}
			}
		}
		_ = rows.Close()
	}

	if hasCredentialHash {
		_, _ = d.db.Exec("DROP TABLE auth_sessions")
	}

	_, err = d.db.Exec(`
		CREATE TABLE IF NOT EXISTS auth_sessions (
			token_hash TEXT PRIMARY KEY,
			role TEXT NOT NULL CHECK (role IN ('admin', 'viewer', 'code')),
			subject TEXT NOT NULL,
			expires_at INTEGER NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	// 3. Access codes & migration
	_, err = d.db.Exec(`
		CREATE TABLE IF NOT EXISTS access_codes (
			id TEXT PRIMARY KEY,
			label TEXT NOT NULL,
			code_hash TEXT NOT NULL UNIQUE,
			trip_ids_json TEXT NOT NULL,
			created_at TEXT NOT NULL,
			expires_at INTEGER
		)
	`)
	if err != nil {
		return err
	}

	var hasExpiresAt bool
	acRows, err := d.db.Query("PRAGMA table_info(access_codes)")
	if err == nil {
		for acRows.Next() {
			var cid int
			var name, colType string
			var notnull, pk int
			var dfltValue interface{}
			if err := acRows.Scan(&cid, &name, &colType, &notnull, &dfltValue, &pk); err == nil {
				if name == "expires_at" {
					hasExpiresAt = true
				}
			}
		}
		_ = acRows.Close()
	}
	if !hasExpiresAt {
		_, _ = d.db.Exec("ALTER TABLE access_codes ADD COLUMN expires_at INTEGER")
	}

	// 4. OIDC Transactions
	_, err = d.db.Exec(`
		CREATE TABLE IF NOT EXISTS oidc_transactions (
			state_hash TEXT PRIMARY KEY,
			nonce TEXT NOT NULL,
			code_verifier TEXT NOT NULL,
			expires_at INTEGER NOT NULL
		)
	`)
	if err != nil {
		return err
	}

	// 5. AI Settings & Secret
	_, err = d.db.Exec(`
		CREATE TABLE IF NOT EXISTS ai_settings (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			provider TEXT NOT NULL,
			base_url TEXT,
			model TEXT NOT NULL,
			api_key_encrypted TEXT,
			updated_at TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS ai_secret (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			secret TEXT NOT NULL,
			created_at TEXT NOT NULL
		);
	`)
	return err
}

// Workspace Operations

func (d *DB) GetWorkspace() (string, bool, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var dataJSON string
	err := d.db.QueryRow("SELECT data_json FROM workspace WHERE id = 1").Scan(&dataJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return dataJSON, true, nil
}

func (d *DB) SaveWorkspace(dataJSON string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec(`
		INSERT INTO workspace (id, data_json) VALUES (1, ?)
		ON CONFLICT(id) DO UPDATE SET data_json = excluded.data_json
	`, dataJSON)
	return err
}

func (d *DB) UpdateNotepad(tripID, notepad string, allowedTripIDs []string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var dataJSON string
	err = tx.QueryRow("SELECT data_json FROM workspace WHERE id = 1").Scan(&dataJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("SQLite 尚未建立旅程資料。")
	}
	if err != nil {
		return err
	}

	var root map[string]interface{}
	if err := json.Unmarshal([]byte(dataJSON), &root); err != nil {
		return errors.New("SQLite 旅程資料不是有效 JSON；記事本未修改。")
	}

	tripsRaw, ok := root["trips"].([]interface{})
	if !ok {
		return errors.New("SQLite 旅程資料格式不正確；記事本未修改。")
	}

	var foundTrip map[string]interface{}
	for _, tr := range tripsRaw {
		tmap, ok := tr.(map[string]interface{})
		if !ok {
			continue
		}
		tid, _ := tmap["id"].(string)
		if tid == tripID {
			if allowedTripIDs != nil {
				hasAccess := false
				for _, aid := range allowedTripIDs {
					if aid == tid {
						hasAccess = true
						break
					}
				}
				if !hasAccess {
					continue
				}
			}
			foundTrip = tmap
			break
		}
	}

	if foundTrip == nil {
		return errors.New("找不到指定旅程；記事本未修改。")
	}

	foundTrip["notepad"] = notepad
	updatedJSON, err := json.Marshal(root)
	if err != nil {
		return err
	}

	_, err = tx.Exec("UPDATE workspace SET data_json = ? WHERE id = 1", string(updatedJSON))
	if err != nil {
		return err
	}

	return tx.Commit()
}

// Session Operations

func (d *DB) GetSession(tokenHash string) (*models.Session, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var s models.Session
	err := d.db.QueryRow("SELECT token_hash, role, subject, expires_at FROM auth_sessions WHERE token_hash = ?", tokenHash).
		Scan(&s.TokenHash, &s.Role, &s.Subject, &s.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (d *DB) CreateSession(tokenHash, role, subject string, expiresAt int64) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec("INSERT INTO auth_sessions (token_hash, role, subject, expires_at) VALUES (?, ?, ?, ?)",
		tokenHash, role, subject, expiresAt)
	return err
}

func (d *DB) DeleteSession(tokenHash string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec("DELETE FROM auth_sessions WHERE token_hash = ?", tokenHash)
	return err
}

func (d *DB) DeleteSessionsBySubject(subject string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec("DELETE FROM auth_sessions WHERE role = 'code' AND subject = ?", subject)
	return err
}

func (d *DB) DeleteExpiredSessions(now int64) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec("DELETE FROM auth_sessions WHERE expires_at <= ?", now)
	return err
}

// Access Code Operations

func (d *DB) GetAccessCodeByHash(codeHash string) (*models.AccessCode, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var ac models.AccessCode
	var expiresAt sql.NullInt64
	err := d.db.QueryRow("SELECT id, label, code_hash, trip_ids_json, created_at, expires_at FROM access_codes WHERE code_hash = ?", codeHash).
		Scan(&ac.ID, &ac.Label, &ac.CodeHash, &ac.TripIDsJSON, &ac.CreatedAt, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if expiresAt.Valid {
		ac.ExpiresAt = &expiresAt.Int64
	}
	return &ac, nil
}

func (d *DB) GetAccessCodeByID(id string) (*models.AccessCode, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var ac models.AccessCode
	var expiresAt sql.NullInt64
	err := d.db.QueryRow("SELECT id, label, code_hash, trip_ids_json, created_at, expires_at FROM access_codes WHERE id = ?", id).
		Scan(&ac.ID, &ac.Label, &ac.CodeHash, &ac.TripIDsJSON, &ac.CreatedAt, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if expiresAt.Valid {
		ac.ExpiresAt = &expiresAt.Int64
	}
	return &ac, nil
}

func (d *DB) ListAccessCodes() ([]models.AccessCode, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	rows, err := d.db.Query("SELECT id, label, code_hash, trip_ids_json, created_at, expires_at FROM access_codes ORDER BY created_at, id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []models.AccessCode
	for rows.Next() {
		var ac models.AccessCode
		var expiresAt sql.NullInt64
		if err := rows.Scan(&ac.ID, &ac.Label, &ac.CodeHash, &ac.TripIDsJSON, &ac.CreatedAt, &expiresAt); err != nil {
			return nil, err
		}
		if expiresAt.Valid {
			ac.ExpiresAt = &expiresAt.Int64
		}
		list = append(list, ac)
	}
	return list, nil
}

func (d *DB) CreateAccessCode(ac models.AccessCode) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	var expiresVal interface{}
	if ac.ExpiresAt != nil {
		expiresVal = *ac.ExpiresAt
	}
	_, err := d.db.Exec(
		"INSERT INTO access_codes (id, label, code_hash, trip_ids_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
		ac.ID, ac.Label, ac.CodeHash, ac.TripIDsJSON, ac.CreatedAt, expiresVal,
	)
	return err
}

func (d *DB) UpdateAccessCode(id string, tripIDsJSON string, expiresAt *int64) (bool, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	var expiresVal interface{}
	if expiresAt != nil {
		expiresVal = *expiresAt
	}
	res, err := d.db.Exec("UPDATE access_codes SET trip_ids_json = ?, expires_at = ? WHERE id = ?", tripIDsJSON, expiresVal, id)
	if err != nil {
		return false, err
	}
	rowsAffected, _ := res.RowsAffected()
	return rowsAffected > 0, nil
}

func (d *DB) DeleteAccessCode(id string) (bool, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	res, err := d.db.Exec("DELETE FROM access_codes WHERE id = ?", id)
	if err != nil {
		return false, err
	}
	rowsAffected, _ := res.RowsAffected()
	return rowsAffected > 0, nil
}

// OIDC Transactions

func (d *DB) SaveOidcTransaction(stateHash, nonce, codeVerifier string, expiresAt int64) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec("INSERT INTO oidc_transactions (state_hash, nonce, code_verifier, expires_at) VALUES (?, ?, ?, ?)",
		stateHash, nonce, codeVerifier, expiresAt)
	return err
}

func (d *DB) GetAndDeleteOidcTransaction(stateHash string) (nonce, codeVerifier string, found bool, err error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	err = d.db.QueryRow("SELECT nonce, code_verifier FROM oidc_transactions WHERE state_hash = ?", stateHash).
		Scan(&nonce, &codeVerifier)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", false, nil
	}
	if err != nil {
		return "", "", false, err
	}
	_, _ = d.db.Exec("DELETE FROM oidc_transactions WHERE state_hash = ?", stateHash)
	return nonce, codeVerifier, true, nil
}

func (d *DB) DeleteExpiredOidcTransactions(now int64) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec("DELETE FROM oidc_transactions WHERE expires_at <= ?", now)
	return err
}

// AI Settings & Secret

func (d *DB) GetAiSettings() (*models.AiSettingsView, *string, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var provider, model, updatedAt string
	var baseURL, encryptedKey sql.NullString
	err := d.db.QueryRow("SELECT provider, base_url, model, api_key_encrypted, updated_at FROM ai_settings WHERE id = 1").
		Scan(&provider, &baseURL, &model, &encryptedKey, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}

	var baseStr *string
	if baseURL.Valid {
		baseStr = &baseURL.String
	}

	var encStr *string
	if encryptedKey.Valid {
		encStr = &encryptedKey.String
	}

	view := &models.AiSettingsView{
		Provider:  provider,
		BaseURL:   baseStr,
		Model:     model,
		HasApiKey: encStr != nil && *encStr != "",
		UpdatedAt: updatedAt,
	}
	return view, encStr, nil
}

func (d *DB) SaveAiSettings(provider string, baseURL *string, model string, apiKeyEncrypted *string, updatedAt string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	var baseVal, keyVal interface{}
	if baseURL != nil {
		baseVal = *baseURL
	}
	if apiKeyEncrypted != nil {
		keyVal = *apiKeyEncrypted
	}

	_, err := d.db.Exec(`
		INSERT INTO ai_settings (id, provider, base_url, model, api_key_encrypted, updated_at) VALUES (1, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			provider = excluded.provider,
			base_url = excluded.base_url,
			model = excluded.model,
			api_key_encrypted = excluded.api_key_encrypted,
			updated_at = excluded.updated_at
	`, provider, baseVal, model, keyVal, updatedAt)
	return err
}

func (d *DB) GetAiSecret() (string, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var secret string
	err := d.db.QueryRow("SELECT secret FROM ai_secret WHERE id = 1").Scan(&secret)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return secret, err
}

func (d *DB) EnsureAiSecretKey() (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	var existing string
	err := d.db.QueryRow("SELECT secret FROM ai_secret WHERE id = 1").Scan(&existing)
	if err == nil && len(existing) >= 32 {
		return existing, nil
	}

	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	secret := base64.RawURLEncoding.EncodeToString(buf)
	now := time.Now().UTC().Format(time.RFC3339)

	_, err = d.db.Exec("INSERT OR IGNORE INTO ai_secret (id, secret, created_at) VALUES (1, ?, ?)", secret, now)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(secret), nil
}
