FROM node:22-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY scripts/sw.mjs ./scripts/sw.mjs
RUN npm run build

FROM golang:1.25-alpine AS backend
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY internal ./internal
COPY cmd/server ./cmd/server
RUN CGO_ENABLED=0 go build -trimpath -o /syncforge ./cmd/server

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && adduser -D app
WORKDIR /app
COPY --from=frontend /app/dist ./dist
COPY --from=backend /syncforge ./syncforge
USER app
ENV PORT=10000
EXPOSE 10000
CMD ["./syncforge"]
