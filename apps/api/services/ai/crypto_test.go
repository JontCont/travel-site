package ai

import (
	"testing"
)

func TestCryptoRoundtrip(t *testing.T) {
	secret := "0123456789abcdef0123456789abcdef" // 32 chars
	plaintext := "sk-ant-api-test-key-12345"

	encrypted, err := EncryptSecret(plaintext, secret)
	if err != nil {
		t.Fatalf("encryption failed: %v", err)
	}

	decrypted, err := DecryptSecret(encrypted, secret)
	if err != nil {
		t.Fatalf("decryption failed: %v", err)
	}

	if decrypted != plaintext {
		t.Fatalf("expected %s, got %s", plaintext, decrypted)
	}
}

func TestCryptoWrongSecret(t *testing.T) {
	secret1 := "0123456789abcdef0123456789abcdef"
	secret2 := "fedcba9876543210fedcba9876543210"

	encrypted, err := EncryptSecret("my-key", secret1)
	if err != nil {
		t.Fatalf("encryption failed: %v", err)
	}

	_, err = DecryptSecret(encrypted, secret2)
	if err == nil {
		t.Fatalf("expected decryption error with wrong secret, got nil")
	}
}

func TestReadSecretKey(t *testing.T) {
	if ReadSecretKey("short") != "" {
		t.Fatalf("expected empty for secret < 32 chars")
	}
	valid := "0123456789abcdef0123456789abcdef"
	if ReadSecretKey(valid) != valid {
		t.Fatalf("expected valid secret to be returned")
	}
}
