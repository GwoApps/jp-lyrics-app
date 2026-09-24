FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py provider_core.py ./
EXPOSE 8910
CMD ["python", "server.py"]
