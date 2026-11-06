"""Runway image-to-video client. No network until submit/sync; no POST retry."""
import argparse
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from contextlib import contextmanager
from datetime import date, datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse

API = 'https://api.dev.runwayml.com/v1'
RATIOS = {'1280:720', '720:1280', '1104:832', '960:960', '832:1104', '1584:672'}


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(temp, path)


def now():
    return datetime.now(timezone.utc).isoformat()


def identifier(value):
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}', value):
        raise ValueError('ID inválido: use letras, números, hífen e sublinhado (até 80).')
    return value


@contextmanager
def locked(workspace):
    folder = workspace / 'jobs'
    folder.mkdir(parents=True, exist_ok=True)
    lock = folder / 'client.lock'
    try:
        handle = lock.open('x')
    except FileExistsError:
        raise ValueError('Cliente ocupado ou lock de processo interrompido. Confira jobs/client.lock.')
    try:
        handle.write(str(os.getpid()))
        handle.close()
        yield
    finally:
        lock.unlink(missing_ok=True)


def credential(workspace):
    value = os.environ.get('RUNWAYML_API_SECRET', '').strip()
    if value:
        return value
    path = workspace / '.secrets' / 'runway.dpapi'
    if os.name == 'nt' and path.exists():
        env = os.environ.copy()
        env['CAIO_RUNWAY_SECRET_FILE'] = str(path)
        result = subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command',
            "$s=Get-Content -LiteralPath $env:CAIO_RUNWAY_SECRET_FILE | ConvertTo-SecureString; "
            "$p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); "
            "try {[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))} "
            "finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}"],
            env=env, capture_output=True, text=True, timeout=20)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
        raise ValueError('Não foi possível abrir a credencial protegida para este usuário Windows.')
    raise ValueError('Chave ausente. Execute configurar-chave.ps1 localmente.')


def api(key, method, endpoint, body=None):
    request = Request(API + endpoint, method=method, headers={
        'Authorization': 'Bearer ' + key,
        'X-Runway-Version': '2024-11-06', 'Content-Type': 'application/json',
        'User-Agent': 'CaioVideoIntegration/1.0'},
        data=json.dumps(body).encode() if body is not None else None)
    try:
        with urlopen(request, timeout=90) as response:
            return json.load(response)
    except HTTPError as error:
        # Never emit response bodies, which might echo request data or tokens.
        raise ValueError(f'Runway HTTP {error.code}. Verifique conta, saldo e parâmetros no portal.') from None
    except (URLError, TimeoutError):
        raise ValueError('Falha de conexão com Runway; nenhuma repetição automática foi feita.') from None


def total_reserved(workspace):
    return round(sum(float(read(p).get('reserved_usd', 0))
                     for p in (workspace / 'jobs').glob('*/job.json')), 6)


def plan(workspace, manifest):
    config = read(workspace / 'config.json')
    manifest = Path(manifest).resolve()
    spec = read(manifest)
    identifier(spec['id'])
    if spec['model'] not in ('gen4.5', 'gen4_turbo', 'hailuo3'):
        raise ValueError('Modelo não suportado nesta integração.')
    if type(spec['duration']) is not int or spec['duration'] not in (5, 10):
        raise ValueError('Use duração de 5 ou 10 segundos.')
    if spec['ratio'] not in (RATIOS if spec['model'] != 'hailuo3' else {'3:4', '9:16', '16:9'}):
        raise ValueError('Proporção não suportada.')
    if not isinstance(spec['prompt'], str) or not 1 <= len(spec['prompt'].strip()) <= 1000:
        raise ValueError('Prompt precisa ter de 1 a 1000 caracteres.')
    timeline = spec.get('timeline', {'from_frame': 0, 'fps': 30})
    if type(timeline.get('from_frame')) is not int or timeline['from_frame'] < 0:
        raise ValueError('from_frame deve ser inteiro não negativo.')
    if type(timeline.get('fps')) is not int or timeline['fps'] not in (24, 25, 30, 60):
        raise ValueError('fps precisa ser 24, 25, 30 ou 60.')
    spec['timeline'] = timeline
    image = (manifest.parent / spec['image']).resolve()
    raw = image.read_bytes()
    if len(raw) > 3500000 or not raw:
        raise ValueError('Imagem deve ter até 3,5 MB para envio base64. Prepare uma cópia menor.')
    mime = ('image/png' if raw.startswith(b'\x89PNG\r\n\x1a\n') else
            'image/jpeg' if raw.startswith(b'\xff\xd8\xff') else
            'image/webp' if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP' else None)
    if not mime:
        raise ValueError('Imagem precisa ser PNG, JPEG ou WebP válido.')
    credit_rate = float(config['credits_per_second'][spec['model']])
    usd_rate = float(config['usd_per_credit'])
    if not all(math.isfinite(n) and n > 0 for n in (credit_rate, usd_rate)):
        raise ValueError('Tabela de preços inválida.')
    references = spec.get('references', [])
    if references and spec['model'] != 'hailuo3':
        raise ValueError('Referencias extras requerem hailuo3.')
    reference_hashes = []
    for ref in references:
        content = Path(ref).read_bytes()
        if not content.startswith(b'\x89PNG\r\n\x1a\n') or len(content) > 3500000:
            raise ValueError('Referencia deve ser PNG ate 3,5 MB.')
        reference_hashes.append(hashlib.sha256(content).hexdigest())
    extra_credits = 2 * (1 + len(references)) if spec['model'] == 'hailuo3' else 0
    cost = round((spec['duration'] * credit_rate + extra_credits) * usd_rate, 6)
    fingerprint = hashlib.sha256(json.dumps({
        'references_sha256': reference_hashes, 'spec': spec, 'image_sha256': hashlib.sha256(raw).hexdigest()
    }, sort_keys=True).encode()).hexdigest()
    return spec, raw, mime, {
        'id': spec['id'], 'image': str(image), 'model': spec['model'],
        'duration_seconds': spec['duration'], 'estimated_usd': cost,
        'reserved_workspace_usd': total_reserved(workspace),
        'budget_usd': config['budget_usd'], 'pricing_checked': config['pricing_checked'],
        'fingerprint': fingerprint, 'network_used': False,
        'output_has_alpha': False,
    }


def submit(workspace, manifest, approved):
    if not approved:
        raise ValueError('Falta --approve-upload após autorização do envio da imagem ao Runway.')
    with locked(workspace):
        spec, raw, mime, summary = plan(workspace, manifest)
        config = read(workspace / 'config.json')
        if (date.today() - date.fromisoformat(config['pricing_checked'])).days > 30:
            raise ValueError('Reconfira a tabela de preços e atualize pricing_checked antes de gerar.')
        path = workspace / 'jobs' / spec['id'] / 'job.json'
        if path.exists():
            previous = read(path)
            if previous['fingerprint'] != summary['fingerprint']:
                raise ValueError('ID já existe com outro conteúdo. Use novo ID para uma nova tentativa autorizada.')
            return {'id': spec['id'], 'status': previous['status'], 'reused': True,
                    'message': 'Nenhuma submissão adicional. Use sync ou attach.'}
        budget = float(config['budget_usd'])
        if not math.isfinite(budget) or not config.get('budget_authorization') or summary['reserved_workspace_usd'] + summary['estimated_usd'] > budget + 1e-8:
            raise ValueError('Orçamento ausente ou insuficiente. Registre um limite autorizado com budget.')
        key = credential(workspace)
        job = dict(summary, spec=spec, status='SUBMITTING', created_at=now(),
                   reserved_usd=summary['estimated_usd'])
        # Persistent reservation BEFORE network; crash/timeout never silently resubmits.
        save(path, job)
        payload = {'model': spec['model'], 'duration': spec['duration'], 'ratio': spec['ratio'],
                   'promptText': spec['prompt'],
                   'promptImage': f'data:{mime};base64,' + base64.b64encode(raw).decode()}
        if spec['model'] == 'hailuo3':
            payload['resolution'] = '768p'
            payload['promptImage'] = [{'uri': payload['promptImage']}]
            for ref in spec.get('references', []):
                payload['promptImage'].append({'uri': 'data:image/png;base64,' + base64.b64encode(Path(ref).read_bytes()).decode()})
        try:
            response = api(key, 'POST', '/image_to_video', payload)
            job['task_id'] = identifier(response['id'])
            job['status'] = 'PENDING'
        except Exception:
            job['status'] = 'UNKNOWN'
            save(path, job)
            raise
        save(path, job)
        return {'id': spec['id'], 'task_id': job['task_id'], 'status': job['status'],
                'reserved_usd': job['reserved_usd']}


def download(url, destination):
    if urlparse(url).scheme != 'https':
        raise ValueError('URL de saída precisa usar HTTPS.')
    temp = destination.with_suffix('.part')
    # No API authorization header is sent to output storage.
    with urlopen(Request(url, headers={'User-Agent': 'CaioVideoIntegration/1.0'}), timeout=90) as response, temp.open('wb') as stream:
        shutil.copyfileobj(response, stream)
    with temp.open('rb') as stream:
        header = stream.read(64)
    if b'ftyp' not in header or temp.stat().st_size < 32:
        raise ValueError('Saída não reconhecida como MP4. Não importada.')
    os.replace(temp, destination)


def sync(workspace, job_id, wait=0):
    with locked(workspace):
        path = workspace / 'jobs' / identifier(job_id) / 'job.json'
        job = read(path)
        if not job.get('task_id'):
            raise ValueError('Sem ID remoto. Recupere no portal e use attach; não reenvie.')
        output = path.parent / 'output.mp4'
        if job['status'] == 'SUCCEEDED' and output.exists():
            return {'id': job_id, 'status': 'SUCCEEDED', 'file': str(output)}
        key = credential(workspace)
        deadline = time.monotonic() + wait
        while True:
            response = api(key, 'GET', '/tasks/' + identifier(job['task_id']))
            job['status'] = response['status']
            job['checked_at'] = now()
            save(path, job)
            if job['status'] == 'SUCCEEDED':
                outputs = response.get('output', [])
                if not outputs:
                    raise ValueError('Tarefa concluída sem arquivo de saída.')
                download(outputs[0], output)
                job['output_file'] = 'output.mp4'
                job['output_sha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
                save(path, job)
                return {'id': job_id, 'status': job['status'], 'file': str(output)}
            if job['status'] in ('FAILED', 'CANCELED', 'CANCELLED') or time.monotonic() + 5 > deadline:
                return {'id': job_id, 'status': job['status']}
            time.sleep(5)


def import_clip(workspace, job_id, project):
    with locked(workspace):
        folder = workspace / 'jobs' / identifier(job_id)
        job = read(folder / 'job.json')
        source = folder / 'output.mp4'
        if job['status'] != 'SUCCEEDED' or not source.exists():
            raise ValueError('Conclua sync/download antes da importação.')
        if hashlib.sha256(source.read_bytes()).hexdigest() != job.get('output_sha256'):
            raise ValueError('Arquivo de vídeo mudou após download. Confira antes de importar.')
        project = Path(project).resolve()
        if not (project / 'src' / 'AiVideoLayer.tsx').exists():
            raise ValueError('Projeto não possui o componente AiVideoLayer instalado.')
        manifest = project / 'src' / 'ai-video-manifest.json'
        clips = read(manifest) if manifest.exists() else []
        spec = job['spec']
        fps = spec['timeline']['fps']
        if any(c['fps'] != fps for c in clips if c['id'] != job_id):
            raise ValueError('Manifesto possui outro FPS. Converta os tempos antes de importar.')
        target = project / 'public' / 'ai-video' / (job_id + '.mp4')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        cue = {'id': job_id, 'src': 'ai-video/' + target.name, 'fps': fps,
               'from': spec['timeline']['from_frame'], 'durationInFrames': spec['duration'] * fps}
        save(manifest, sorted([c for c in clips if c['id'] != job_id] + [cue], key=lambda c: c['from']))
        return {'file': str(target), 'manifest': str(manifest), 'composition': 'VideoIACinematico'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', required=True, type=Path)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('doctor')
    p = sub.add_parser('plan'); p.add_argument('manifest')
    p = sub.add_parser('budget'); p.add_argument('--usd', required=True, type=float); p.add_argument('--note', required=True)
    p = sub.add_parser('submit'); p.add_argument('manifest'); p.add_argument('--approve-upload', action='store_true')
    p = sub.add_parser('sync'); p.add_argument('id'); p.add_argument('--wait', type=int, default=0, choices=range(0, 61))
    p = sub.add_parser('attach'); p.add_argument('id'); p.add_argument('--task-id', required=True)
    p = sub.add_parser('import'); p.add_argument('id'); p.add_argument('--project', required=True)
    args = parser.parse_args(argv)
    workspace = args.workspace.resolve()
    try:
        if args.command == 'doctor':
            result = {'workspace': str(workspace), 'config_present': (workspace / 'config.json').exists(),
                      'credential_present': bool(os.environ.get('RUNWAYML_API_SECRET')) or (workspace / '.secrets/runway.dpapi').exists(),
                      'authentication_tested': False, 'network_used': False}
        elif args.command == 'plan':
            result = plan(workspace, args.manifest)[3]
        elif args.command == 'budget':
            if not math.isfinite(args.usd) or args.usd < 0 or not args.note.strip():
                raise ValueError('Limite deve ser número finito não negativo e ter referência à autorização.')
            with locked(workspace):
                config = read(workspace / 'config.json')
                config.update(budget_usd=args.usd, budget_authorization={'note': args.note, 'at': now()})
                save(workspace / 'config.json', config)
            result = {'budget_usd': args.usd, 'reserved_usd': total_reserved(workspace)}
        elif args.command == 'submit':
            result = submit(workspace, args.manifest, args.approve_upload)
        elif args.command == 'sync':
            result = sync(workspace, args.id, args.wait)
        elif args.command == 'attach':
            with locked(workspace):
                path = workspace / 'jobs' / identifier(args.id) / 'job.json'
                job = read(path)
                if job.get('task_id'):
                    raise ValueError('Já existe um ID remoto associado. Não será substituído.')
                job.update(task_id=identifier(args.task_id), status='PENDING', attached_at=now())
                save(path, job)
            result = {'id': args.id, 'status': 'PENDING'}
        else:
            result = import_clip(workspace, args.id, args.project)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as error:
        # Avoid displaying URLs (signed downloads) or raw transport messages.
        message = str(error) if isinstance(error, ValueError) else f'Falha local: {type(error).__name__}. Confira arquivos e configuração.'
        print(json.dumps({'error': message}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
