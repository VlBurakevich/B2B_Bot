FROM node:24-bookworm-slim
WORKDIR /app
RUN groupadd --gid 10001 bot && useradd --uid 10001 --gid bot --no-create-home bot && mkdir /app/data && chown bot:bot /app/data
COPY --chown=bot:bot bot.mjs protocol.mjs telegram.mjs package.json ./
USER bot
ENV BOT_DATA_DIR=/app/data BOT_BIND=0.0.0.0 PORT=3103
CMD ["node","bot.mjs"]
