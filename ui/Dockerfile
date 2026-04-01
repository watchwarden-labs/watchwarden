FROM node:22-alpine AS builder
WORKDIR /app

# Set up workspace structure for local package resolution
COPY package.json ./
COPY packages/types/package.json packages/types/tsconfig.json ./packages/types/
COPY packages/types/src/ ./packages/types/src/

# Build the types package
RUN cd packages/types && npm install && npm run build

# Install UI dependencies (workspace hoists to root node_modules)
COPY ui/package*.json ./ui/
RUN --mount=type=cache,target=/root/.npm npm install -w ui

# Build the UI
COPY ui/ ./ui/
RUN npm run -w ui build

# Production image
FROM nginxinc/nginx-unprivileged:stable-alpine
COPY --from=builder /app/ui/dist /usr/share/nginx/html
COPY ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q --spider http://localhost:8080 || exit 1
CMD ["nginx", "-g", "daemon off;"]
