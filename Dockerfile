# ===== Backend: Strapi 5 (TypeScript) =====
# Положить этот файл в КОРЕНЬ репозитория ESC-Backend

# ---------- build stage ----------
FROM node:20-alpine AS build

# Зависимости для сборки нативных модулей (better-sqlite3, sharp/vips)
RUN apk add --no-cache build-base gcc autoconf automake zlib-dev libpng-dev nasm bash vips-dev git python3

WORKDIR /opt/app

COPY package.json package-lock.json ./
RUN npm ci
# В репозитории нет драйвера PostgreSQL — доустанавливаем
RUN npm install pg@8.13.1

COPY . .

ENV NODE_ENV=production
RUN npm run build

# ---------- runtime stage ----------
FROM node:20-alpine

RUN apk add --no-cache vips-dev

WORKDIR /opt/app
ENV NODE_ENV=production

# Копируем всё приложение вместе с node_modules и собранным admin
COPY --from=build /opt/app ./

# Папка для загруженных файлов (медиа), монтируется как volume в Dokploy
RUN mkdir -p /opt/app/public/uploads

EXPOSE 1337
CMD ["npm", "run", "start"]
