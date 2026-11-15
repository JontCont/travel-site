package middleware

import (
	"strings"
	"sync"
	"time"

	"travel-api/config"

	"github.com/gin-gonic/gin"
)

type Attempt struct {
	FailedCount  int
	BlockedUntil time.Time
}

type RateLimiter struct {
	mu       sync.Mutex
	attempts map[string]*Attempt
}

func NewRateLimiter() *RateLimiter {
	return &RateLimiter{
		attempts: make(map[string]*Attempt),
	}
}

func (rl *RateLimiter) ClientAddress(c *gin.Context, cfg config.Config) string {
	if cfg.TrustProxy {
		cf := strings.TrimSpace(c.GetHeader("CF-Connecting-IP"))
		if cf != "" {
			return cf
		}
		forwarded := strings.TrimSpace(c.GetHeader("X-Forwarded-For"))
		if forwarded != "" {
			parts := strings.Split(forwarded, ",")
			if len(parts) > 0 {
				return strings.TrimSpace(parts[len(parts)-1])
			}
		}
	}
	ip := c.ClientIP()
	if ip == "" {
		return "unknown"
	}
	return ip
}

func (rl *RateLimiter) CheckBlocked(address string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	att, exists := rl.attempts[address]
	if !exists {
		return false
	}
	if !att.BlockedUntil.IsZero() && att.BlockedUntil.After(time.Now()) {
		return true
	}
	return false
}

func (rl *RateLimiter) RecordFailure(address string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	att, exists := rl.attempts[address]
	if !exists {
		att = &Attempt{}
		rl.attempts[address] = att
	} else if !att.BlockedUntil.IsZero() && att.BlockedUntil.Before(now) {
		att.FailedCount = 0
		att.BlockedUntil = time.Time{}
	}

	att.FailedCount++
	if att.FailedCount >= 5 {
		att.BlockedUntil = now.Add(15 * time.Minute)
	}
}

func (rl *RateLimiter) RecordSuccess(address string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	delete(rl.attempts, address)
}
