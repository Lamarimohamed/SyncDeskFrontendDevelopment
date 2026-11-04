$ErrorActionPreference = "Stop"

docker compose config | Out-Host
docker compose build | Out-Host
docker compose up -d | Out-Host

try {
  docker compose ps | Out-Host
  foreach ($service in @("replica-a", "replica-b", "replica-c")) {
    docker compose exec -T $service node -e "fetch('http://127.0.0.1:8787/health').then(async response => { if (!response.ok) process.exit(1); console.log(await response.text()) }).catch(() => process.exit(1))" | Out-Host
  }

  docker compose run --rm experiment-runner | Out-Host
  docker compose restart replica-b | Out-Host
  docker compose run --rm experiment-runner | Out-Host

  $offlineContainer = docker compose ps -q replica-c
  docker network disconnect syncdesk $offlineContainer
  try {
    docker compose run --rm -e REPLICA_URLS=http://replica-a:8787,http://replica-b:8787 experiment-runner | Out-Host
  } finally {
    docker network connect syncdesk $offlineContainer
  }

  docker compose run --rm experiment-runner | Out-Host
  docker compose logs --no-color | Out-Host
} finally {
  docker compose down | Out-Host
}
