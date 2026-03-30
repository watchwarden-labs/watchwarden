FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-slim
RUN groupadd -r warden && useradd -r -g warden warden
WORKDIR /app
COPY --from=builder /app/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev && chown -R warden:warden /app
COPY --from=builder --chown=warden:warden /app/dist ./dist
COPY --chown=warden:warden src/db/migrations ./src/db/migrations
USER warden
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
