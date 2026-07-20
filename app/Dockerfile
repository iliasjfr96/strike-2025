# Dockerfile — build unique, runtime Node 20 Alpine
FROM node:20-alpine
WORKDIR /app

# Dépendances (reproductible si lockfile présent, sinon install)
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Sources + build client (dist/) et serveur (dist-server/)
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
