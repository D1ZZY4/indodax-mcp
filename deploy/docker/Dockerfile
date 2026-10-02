FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY target/release/indodax /usr/local/bin/indodax
EXPOSE 8000
ENTRYPOINT ["indodax", "system", "health"]
