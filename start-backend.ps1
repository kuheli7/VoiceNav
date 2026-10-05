# Starts the VoiceNav AI backend on http://127.0.0.1:8000 (needs Ollama running with the model pulled).
$ErrorActionPreference = "Stop"
Set-Location "$PSScriptRoot\backend"
if (-not (Test-Path .\.venv\Scripts\python.exe)) {
    Write-Host "First run: creating virtual environment..."
    py -3.11 -m venv .venv
    & .\.venv\Scripts\python.exe -m pip install -r requirements.txt
}
# If offline speech (Whisper) is installed, load its model now so the first spoken command isn't the slow one
$env:VOICENAV_PRELOAD_WHISPER = "1"
# Bind to localhost only: this service should never be reachable from the network.
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
