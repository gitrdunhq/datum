FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Install uv securely
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /app

# Copy the repository
COPY . /app/

# Install MCP and any other dependencies defined in scripts/datum.py or natively
RUN uv pip install --system mcp httpx

# Expose the SSE Port
EXPOSE 8000

# Set Python Path so datum module can be resolved
ENV PYTHONPATH=/app

# Start the SSE MCP Server
CMD ["python3", "scripts/datum.py", "datum.mcp.server"]
