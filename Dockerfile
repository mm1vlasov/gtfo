# Discord-бот на Node.js (не Python)
FROM node:20-alpine

WORKDIR /app

# Зависимости
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Код бота
COPY . .

# Запуск
CMD ["node", "bot.js"]
