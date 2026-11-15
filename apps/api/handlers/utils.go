package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"time"
)

func timeNowMilli() int64 {
	return time.Now().UnixMilli()
}

func sha256Hex(val string) string {
	h := sha256.Sum256([]byte(val))
	return hex.EncodeToString(h[:])
}

func formatISO(milli int64) string {
	return time.UnixMilli(milli).UTC().Format(time.RFC3339Nano)
}
