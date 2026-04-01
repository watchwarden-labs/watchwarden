FROM node:22-slim AS builder
WORKDIR /app

# Set up workspace structure for local package resolution
COPY package.json ./
COPY packages/types/package.json packages/types/tsconfig.json ./packages/types/
COPY packages/types/src/ ./packages/types/src/

# Build the types package
RUN cd packages/types && npm install && npm run build

# Install controller dependencies (workspace hoists to root node_modules)
COPY controller/package*.json ./controller/
RUN --mount=type=cache,target=/root/.npm npm install -w controller

# Build the controller
COPY controller/tsconfig.json ./controller/
COPY controller/src/ ./controller/src/
RUN npm run -w controller build

# Prune dev dependencies for production
RUN npm prune --omit=dev -w controller

# Production image
FROM node:22-slim
RUN groupadd -r warden && useradd -r -g warden warden
WORKDIR /app

# Copy hoisted node_modules (contains all deps + @watchwarden/types symlink)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder --chown=warden:warden /app/controller/dist ./dist
COPY --from=builder /app/controller/package.json ./
COPY --chown=warden:warden controller/src/db/migrations ./src/db/migrations
RUN chown -R warden:warden /app
USER warden
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
