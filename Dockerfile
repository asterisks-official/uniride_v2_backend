FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
RUN npx prisma generate && npm run build

FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
