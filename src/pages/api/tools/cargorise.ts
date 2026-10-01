import type { APIRoute } from 'astro';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const prerender = false;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function resolveCargoRiseBin(): string {
  const configured = import.meta.env.CARGORISE_BIN;
  if (configured) return configured;

  const exeName = process.platform === 'win32' ? 'cargo_rise_core.exe' : 'cargo_rise_core';
  const localDebug = join(process.cwd(), 'Tools-Part', 'CargoRise_v0.2.0', 'backend', 'target', 'debug', exeName);
  if (existsSync(localDebug)) return localDebug;

  const localPortable = join(process.cwd(), 'Tools-Part', 'CargoRise_v0.2.0', exeName);
  if (existsSync(localPortable)) return localPortable;

  return exeName;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => null);
    const action = typeof body?.action === 'string' ? body.action : '';

    if (action !== 'detect') {
      return jsonResponse({
        ok: false,
        action: action || 'unknown',
        tool: 'cargorise',
        code: 'UNSUPPORTED_ACTION',
        message: '第一阶段仅支持 CargoRise 环境检测'
      }, 400);
    }

    const cargoRiseBin = resolveCargoRiseBin();
    const { stdout, stderr } = await execFileAsync(cargoRiseBin, ['detect', '--json'], {
      timeout: 10000,
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });

    if (stderr.trim()) {
      console.error('CargoRise detect stderr:', stderr.slice(0, 1000));
    }

    let data: unknown;
    try {
      data = JSON.parse(stdout);
    } catch (error) {
      console.error('CargoRise detect JSON 解析失败:', stdout.slice(0, 1000));
      return jsonResponse({
        ok: false,
        action: 'detect',
        tool: 'cargorise',
        code: 'INVALID_TOOL_OUTPUT',
        message: 'CargoRise 返回了无法解析的检测结果'
      }, 502);
    }

    return jsonResponse({
      ok: true,
      action: 'detect',
      tool: 'cargorise',
      data
    });
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return jsonResponse({
        ok: false,
        action: 'detect',
        tool: 'cargorise',
        code: 'CARGORISE_NOT_FOUND',
        message: '未找到 CargoRise CLI，请配置 CARGORISE_BIN 或确认 cargo_rise_core 已加入 PATH'
      }, 503);
    }

    console.error('CargoRise detect 调用失败:', {
      message: error?.message,
      stderr: typeof error?.stderr === 'string' ? error.stderr.slice(0, 1000) : undefined
    });

    return jsonResponse({
      ok: false,
      action: 'detect',
      tool: 'cargorise',
      code: 'CARGORISE_DETECT_FAILED',
      message: 'CargoRise 环境检测失败'
    }, 502);
  }
};
