FROM python:3.11-slim

WORKDIR /app

# Install system dependencies required for OpenCascade (CadQuery)
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Expose the port
EXPOSE 8000

# Start the FastAPI engine
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
