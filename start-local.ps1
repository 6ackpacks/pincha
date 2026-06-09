# 一键启动脚本 (PowerShell)
# 用法: .\start-local.ps1
# Ctrl+C 停止所有服务

$ProjectRoot = $PSScriptRoot
$BackendDir = "$ProjectRoot\backend"
$FrontendDir = "$ProjectRoot\frontend"

# 加载 .env 文件到当前进程环境变量
$envFile = "$ProjectRoot\.env"
if (Test-Path $envFile) {
    Write-Host ">>> 加载 .env 环境变量..." -ForegroundColor Cyan
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
        }
    }
}

$jobs = @()

function Cleanup {
    Write-Host "`n>>> 停止所有服务..." -ForegroundColor Yellow
    $jobs | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
    Write-Host ">>> 已全部停止" -ForegroundColor Green
}

# 启动基础设施
Write-Host ">>> 启动基础设施 (db/redis/minio/bgutil)..." -ForegroundColor Cyan
docker compose -f "$ProjectRoot\docker-compose.infra.yml" up -d
Write-Host ">>> 等待 PostgreSQL 就绪..." -ForegroundColor Cyan
Start-Sleep -Seconds 3

# 启动各服务
Write-Host ">>> 启动 Backend..." -ForegroundColor Cyan
$jobs += Start-Process -PassThru -NoNewWindow -WorkingDirectory $BackendDir -FilePath "uvicorn" -ArgumentList "app.main:app --reload --port 8000"

Write-Host ">>> 启动 Celery Fast..." -ForegroundColor Cyan
$jobs += Start-Process -PassThru -NoNewWindow -WorkingDirectory $BackendDir -FilePath "celery" -ArgumentList "-A app.tasks.celery_app worker -Q pingcha -c 4 -P solo"

Write-Host ">>> 启动 Celery Pipeline..." -ForegroundColor Cyan
$jobs += Start-Process -PassThru -NoNewWindow -WorkingDirectory $BackendDir -FilePath "celery" -ArgumentList "-A app.tasks.celery_app worker -Q pingcha.pipeline -c 2 -P solo"

Write-Host ">>> 启动 Celery Beat..." -ForegroundColor Cyan
$jobs += Start-Process -PassThru -NoNewWindow -WorkingDirectory $BackendDir -FilePath "celery" -ArgumentList "-A app.tasks.celery_app beat"

Write-Host ">>> 启动 Frontend..." -ForegroundColor Cyan
$jobs += Start-Process -PassThru -NoNewWindow -WorkingDirectory $FrontendDir -FilePath "cmd.exe" -ArgumentList "/c npm run dev"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "  所有服务已启动"                          -ForegroundColor Green
Write-Host "  访问: http://localhost:3000"             -ForegroundColor Green
Write-Host "  按 Ctrl+C 停止所有服务"                  -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green

try {
    while ($true) {
        Start-Sleep -Seconds 1
        # 检查是否有进程意外退出
        $exited = $jobs | Where-Object { $_.HasExited }
        if ($exited) {
            foreach ($p in $exited) {
                Write-Host "警告: 进程 $($p.ProcessName) (PID $($p.Id)) 已退出" -ForegroundColor Red
            }
            $jobs = $jobs | Where-Object { -not $_.HasExited }
            if ($jobs.Count -eq 0) {
                Write-Host "所有服务已退出" -ForegroundColor Red
                break
            }
        }
    }
} finally {
    Cleanup
}
