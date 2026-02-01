/**
 * Загрузка конфигурации.
 * Токен берётся из переменной окружения BOT_TOKEN или DISCORD_TOKEN (для хостинга),
 * иначе из config.json.
 * Если config.json отсутствует (например, после клонирования репозитория),
 * используется config.example.json.
 */
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');
const examplePath = path.join(__dirname, 'config.example.json');

const rawPath = fs.existsSync(configPath) ? configPath : examplePath;
const config = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

config.token = process.env.BOT_TOKEN || process.env.DISCORD_TOKEN || config.token || '';

module.exports = config;
