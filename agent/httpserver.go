package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"
)

var startTime = time.Now()

// startHTTPServer starts the HTTP status server for health checks and API endpoints.
// Available in both Solo and Managed modes.
func startHTTPServer(cfg *AgentConfig, docker *DockerClient, eventLog *EventLog,
	runner *SoloRunner, dockerVer *DockerVersionInfo) {

	mux := http.NewServeMux()

	// Health endpoint — always unauthenticated (Docker HEALTHCHECK)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		mode := "managed"
		if cfg.ControllerURL == "" {
			mode = "solo"
		}
		writeJSON(w, map[string]interface{}{
			"status": "ok",
			"mode":   mode,
			"uptime": time.Since(startTime).Round(time.Second).String(),
		})
	})

	// API endpoints — token auth if configured
	auth := tokenAuthMiddleware(cfg.HTTPToken)

	mux.HandleFunc("GET /api/status", auth(func(w http.ResponseWriter, _ *http.Request) {
		mode := "managed"
		if cfg.ControllerURL == "" {
			mode = "solo"
		}
		status := map[string]interface{}{
			"mode":       mode,
			"agentName":  cfg.AgentName,
			"uptime":     time.Since(startTime).Round(time.Second).String(),
			"schedule":   cfg.Schedule,
			"autoUpdate": cfg.AutoUpdate,
		}
		if dockerVer != nil {
			status["dockerVersion"] = dockerVer.ServerVersion
			status["dockerApiVersion"] = dockerVer.APIVersion
			status["os"] = dockerVer.OS
			status["arch"] = dockerVer.Arch
		}
		writeJSON(w, status)
	}))

	mux.HandleFunc("GET /api/containers", auth(func(w http.ResponseWriter, r *http.Request) {
		containers, err := docker.ListContainers(r.Context())
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
			return
		}
		writeJSON(w, containers)
	}))

	mux.HandleFunc("GET /api/events", auth(func(w http.ResponseWriter, r *http.Request) {
		limit := 50
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				limit = n
			}
		}
		if eventLog == nil {
			writeJSON(w, []Event{})
			return
		}
		writeJSON(w, eventLog.Recent(limit))
	}))

	// Solo-mode-only write endpoints
	mux.HandleFunc("POST /api/check", auth(func(w http.ResponseWriter, _ *http.Request) {
		if runner == nil {
			http.Error(w, `{"error":"only available in Solo Mode"}`, http.StatusServiceUnavailable)
			return
		}
		go runner.runCheckCycle(context.Background())
		w.WriteHeader(http.StatusAccepted)
		writeJSON(w, map[string]string{"message": "Check initiated"})
	}))

	mux.HandleFunc("POST /api/update/{id}", auth(func(w http.ResponseWriter, r *http.Request) {
		if runner == nil {
			http.Error(w, `{"error":"only available in Solo Mode"}`, http.StatusServiceUnavailable)
			return
		}
		containerID := r.PathValue("id")
		if containerID == "" {
			http.Error(w, `{"error":"container ID required"}`, http.StatusBadRequest)
			return
		}
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
			defer cancel()
			var result *UpdateResult
			var err error
			if runner.config.UpdateStrategy == "start-first" {
				result, err = runner.updater.BlueGreenUpdate(ctx, containerID)
			} else {
				result, err = runner.updater.UpdateContainer(ctx, containerID)
			}
			if result == nil && err != nil {
				result = &UpdateResult{ContainerID: containerID, Success: false, Error: err.Error()}
			}
			if result != nil {
				runner.eventLog.Add(Event{
					Time: time.Now(), Type: "update",
					ContainerName: result.ContainerName, Success: result.Success,
					Error: result.Error, DurationMs: result.DurationMs,
				})
				runner.notifier.NotifyResult(result)
			}
		}()
		w.WriteHeader(http.StatusAccepted)
		writeJSON(w, map[string]string{"message": "Update initiated"})
	}))

	addr := ":" + cfg.HTTPPort
	log.Printf("[http] Status server listening on %s", addr)
	server := &http.Server{Addr: addr, Handler: mux, ReadTimeout: 10 * time.Second, WriteTimeout: 30 * time.Second}
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Printf("[http] Server error: %v", err)
	}
}

func tokenAuthMiddleware(token string) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if token == "" {
				next(w, r)
				return
			}
			auth := r.Header.Get("Authorization")
			if auth != "Bearer "+token {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			next(w, r)
		}
	}
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
