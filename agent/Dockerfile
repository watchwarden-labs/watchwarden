FROM golang:1.25-alpine AS builder
ENV GOTOOLCHAIN=auto
RUN apk add --no-cache git ca-certificates
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w -X main.Version=${VERSION}" -o /watchwarden-agent .

FROM alpine:3.21
# su-exec: lightweight privilege-drop tool (like gosu but ~10KB)
RUN apk add --no-cache ca-certificates tzdata su-exec && \
    addgroup -S warden && \
    adduser -S warden -G warden
COPY --from=builder /watchwarden-agent /usr/local/bin/watchwarden-agent
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
# Runs as root so entrypoint can add warden to the docker socket group,
# then drops to warden via su-exec before executing the agent binary.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD pgrep watchwarden-agent || exit 1
ENTRYPOINT ["entrypoint.sh"]
