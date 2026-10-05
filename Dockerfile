# Optional: works on Railway / Fly / any Docker host
FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm run build && npm prune --prefix server --omit=dev
ENV NODE_ENV=production
EXPOSE 5000
CMD ["npm", "start"]
