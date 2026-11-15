package ai

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

var aiSkillNames = []string{
	"travel-plan-foundation",
	"itinerary-timeline",
	"walkable-map-routing",
	"travel-record-writing",
	"trip-photo-album",
}

const maxSkillCharacters = 12000

var (
	skillsCache string
	skillsOnce  sync.Once
	frontmatterRegex = regexp.MustCompile(`(?s)^---\r?\n.*?\r?\n---\r?\n?`)
)

func findSkillsRoot() string {
	candidates := []string{
		".agents/skills",
		"../../.agents/skills",
		"../../../.agents/skills",
		".github/skills",
		"../../.github/skills",
	}
	for _, c := range candidates {
		if fi, err := os.Stat(c); err == nil && fi.IsDir() {
			return c
		}
	}
	return ".agents/skills"
}

func stripFrontmatter(text string) string {
	loc := frontmatterRegex.FindStringIndex(text)
	if loc != nil && loc[0] == 0 {
		return text[loc[1]:]
	}
	return text
}

func LoadAiSkills() string {
	skillsOnce.Do(func() {
		root := findSkillsRoot()
		var sections []string
		for _, name := range aiSkillNames {
			skillPath := filepath.Join(root, name, "SKILL.md")
			bytes, err := os.ReadFile(skillPath)
			if err != nil {
				continue
			}
			content := strings.TrimSpace(stripFrontmatter(string(bytes)))
			if len(content) > maxSkillCharacters {
				content = content[:maxSkillCharacters]
			}
			sections = append(sections, fmt.Sprintf("## Skill: %s\n\n%s", name, content))
		}
		skillsCache = strings.Join(sections, "\n\n")
	})
	return skillsCache
}
