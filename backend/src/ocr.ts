import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const WINDOWS_OCR_SCRIPT = `
param([string]$ImagePath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType=WindowsRuntime]
$file = [System.WindowsRuntimeSystemExtensions]::AsTask([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)).GetAwaiter().GetResult()
$stream = [System.WindowsRuntimeSystemExtensions]::AsTask($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)).GetAwaiter().GetResult()
$decoder = [System.WindowsRuntimeSystemExtensions]::AsTask([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)).GetAwaiter().GetResult()
$bitmap = [System.WindowsRuntimeSystemExtensions]::AsTask($decoder.GetSoftwareBitmapAsync()).GetAwaiter().GetResult()
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
  throw 'Windows OCR engine unavailable.'
}
$result = [System.WindowsRuntimeSystemExtensions]::AsTask($engine.RecognizeAsync($bitmap)).GetAwaiter().GetResult()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Output $result.Text
`;

export type ImageOcrResult = {
  status: 'completed' | 'failed' | 'unavailable';
  text?: string;
  error?: string;
};

export async function extractImageTextLocal(imagePath: string): Promise<ImageOcrResult> {
  if (process.platform !== 'win32') {
    return {
      status: 'unavailable'
    };
  }

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        WINDOWS_OCR_SCRIPT,
        '-ImagePath',
        imagePath
      ],
      {
        timeout: 30_000,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      }
    );

    const text = stdout.trim();
    if (!text) {
      return {
        status: 'failed',
        error: 'OCR returned no text.'
      };
    }

    return {
      status: 'completed',
      text
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
