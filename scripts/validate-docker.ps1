$ErrorActionPreference = "Stop"

docker compose config | Out-Host
docker compose build | Out-Host
docker compose up -d | Out-Host

try {
  docker compose ps | Out-Host
  docker compose exec -T backend node -e "fetch('http://127.0.0.1:8787/health').then(async response => { if (!response.ok) process.exit(1); console.log(await response.text()) }).catch(() => process.exit(1))" | Out-Host
  docker compose exec -T frontend node -e "fetch('http://127.0.0.1:8443/healthz').then(async response => { if (!response.ok) process.exit(1); console.log(await response.text()) }).catch(() => process.exit(1))" | Out-Host
  docker compose exec -T frontend node -e "fetch('http://127.0.0.1:8443/api/health').then(async response => { if (!response.ok) process.exit(1); console.log(await response.text()) }).catch(() => process.exit(1))" | Out-Host

  docker compose restart backend | Out-Host
  docker compose exec -T frontend node -e "fetch('http://127.0.0.1:8443/api/health').then(async response => { if (!response.ok) process.exit(1); console.log(await response.text()) }).catch(() => process.exit(1))" | Out-Host
  docker compose logs --no-color | Out-Host
} finally {
  docker compose down | Out-Host
}
