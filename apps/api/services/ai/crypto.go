package ai

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"

	"golang.org/x/crypto/hkdf"
)

const (
	keyInfo            = "travel-site ai settings v1"
	keySalt            = "travel-site"
	minimumSecretLength = 32
)

func ReadSecretKey(value string) string {
	if len(value) >= minimumSecretLength {
		return value
	}
	return ""
}

func deriveKey(secret string) ([]byte, error) {
	kdf := hkdf.New(sha256.New, []byte(secret), []byte(keySalt), []byte(keyInfo))
	key := make([]byte, 32)
	if _, err := io.ReadFull(kdf, key); err != nil {
		return nil, err
	}
	return key, nil
}

// EncryptSecret encrypts plaintext using AES-256-GCM with HKDF derived key.
// Returns "v1.<iv_base64url>.<tag_base64url>.<ciphertext_base64url>"
func EncryptSecret(plaintext, secret string) (string, error) {
	key, err := deriveKey(secret)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	iv := make([]byte, gcm.NonceSize()) // 12 bytes
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return "", err
	}

	// In Go, gcm.Seal appends ciphertext + 16-byte tag
	sealed := gcm.Seal(nil, iv, []byte(plaintext), nil)
	tagSize := gcm.Overhead() // 16
	ciphertext := sealed[:len(sealed)-tagSize]
	tag := sealed[len(sealed)-tagSize:]

	b64 := base64.RawURLEncoding
	return fmt.Sprintf("v1.%s.%s.%s",
		b64.EncodeToString(iv),
		b64.EncodeToString(tag),
		b64.EncodeToString(ciphertext),
	), nil
}

// DecryptSecret decrypts "v1.<iv_base64url>.<tag_base64url>.<ciphertext_base64url>" using AES-256-GCM.
func DecryptSecret(payload, secret string) (string, error) {
	parts := strings.Split(payload, ".")
	if len(parts) != 4 || parts[0] != "v1" {
		return "", errors.New("AI 金鑰格式不正確。")
	}

	b64 := base64.RawURLEncoding
	iv, err := b64.DecodeString(parts[1])
	if err != nil {
		return "", errors.New("AI 金鑰格式不正確。")
	}
	tag, err := b64.DecodeString(parts[2])
	if err != nil {
		return "", errors.New("AI 金鑰格式不正確。")
	}
	ciphertext, err := b64.DecodeString(parts[3])
	if err != nil {
		return "", errors.New("AI 金鑰格式不正確。")
	}

	key, err := deriveKey(secret)
	if err != nil {
		return "", err
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	// Go's Open expects ciphertext with tag appended
	ciphertextWithTag := append(ciphertext, tag...)
	plaintext, err := gcm.Open(nil, iv, ciphertextWithTag, nil)
	if err != nil {
		return "", errors.New("無法解密已儲存的 API Key，請重新輸入 API Key。")
	}

	return string(plaintext), nil
}
