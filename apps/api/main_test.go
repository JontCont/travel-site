package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveStaticFile(t *testing.T) {
	baseDir := t.TempDir()
	distDir := filepath.Join(baseDir, "dist")
	assetsDir := filepath.Join(distDir, "assets")
	if err := os.MkdirAll(assetsDir, 0o755); err != nil {
		t.Fatalf("failed to create assets dir: %v", err)
	}

	indexFile := filepath.Join(distDir, "index.html")
	if err := os.WriteFile(indexFile, []byte("<html></html>"), 0o644); err != nil {
		t.Fatalf("failed to write index.html: %v", err)
	}
	appJS := filepath.Join(assetsDir, "app.js")
	if err := os.WriteFile(appJS, []byte("console.log('ok');"), 0o644); err != nil {
		t.Fatalf("failed to write app.js: %v", err)
	}

	// Create a file outside distDir to verify traversal cannot reach it even if it exists.
	secretFile := filepath.Join(baseDir, "secret.txt")
	if err := os.WriteFile(secretFile, []byte("secret"), 0o644); err != nil {
		t.Fatalf("failed to write secret.txt: %v", err)
	}

	tests := []struct {
		name     string
		reqPath  string
		wantPath string
		wantOK   bool
	}{
		{
			name:     "valid asset file",
			reqPath:  "/assets/app.js",
			wantPath: appJS,
			wantOK:   true,
		},
		{
			name:     "explicit index.html",
			reqPath:  "/index.html",
			wantPath: indexFile,
			wantOK:   true,
		},
		{
			name:     "root path falls back to index.html",
			reqPath:  "/",
			wantPath: indexFile,
			wantOK:   false,
		},
		{
			name:     "directory path falls back to index.html",
			reqPath:  "/assets",
			wantPath: indexFile,
			wantOK:   false,
		},
		{
			name:     "missing file falls back to index.html",
			reqPath:  "/nonexistent.js",
			wantPath: indexFile,
			wantOK:   false,
		},
		{
			name:     "traversal to parent secret file falls back to index.html",
			reqPath:  "/../secret.txt",
			wantPath: indexFile,
			wantOK:   false,
		},
		{
			name:     "traversal to /etc/passwd falls back to index.html",
			reqPath:  "/../etc/passwd",
			wantPath: indexFile,
			wantOK:   false,
		},
		{
			name:     "deep traversal falls back to index.html",
			reqPath:  "/../../secret",
			wantPath: indexFile,
			wantOK:   false,
		},
		{
			name:     "nested traversal from assets falls back to index.html",
			reqPath:  "/assets/../../secret.txt",
			wantPath: indexFile,
			wantOK:   false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gotPath, gotOK := resolveStaticFile(distDir, tc.reqPath)
			if gotOK != tc.wantOK {
				t.Fatalf("resolveStaticFile(%q) ok = %v, want %v (path=%q)", tc.reqPath, gotOK, tc.wantOK, gotPath)
			}
			if gotPath != tc.wantPath {
				t.Fatalf("resolveStaticFile(%q) path = %q, want %q", tc.reqPath, gotPath, tc.wantPath)
			}
		})
	}
}
