// typescript
import express from 'express';
import multer from 'multer';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const BASE_DIR = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(BASE_DIR, { recursive: true });

type MulterRequest = express.Request<{ path: string }> & { file?: Express.Multer.File };

const PORT = Number(process.env.PORT || 4500);

function now(): string {
    return new Date().toISOString();
}

function log(...args: unknown[]): void {
    console.log(`[${now()}]`, ...args);
}

function logError(...args: unknown[]): void {
    console.error(`[${now()}]`, ...args);
}

function resolvePath(filePath: string | string[]): string {
    if (!filePath) {
        throw new Error('Missing path');
    }

    // normalize array params (e.g. ['a','b','c']) into a single path string "a/b/c"
    if (Array.isArray(filePath)) {
        filePath = filePath.join('/');
    }

    if (filePath.startsWith('/')) {
        filePath = filePath.slice(1);
    }

    const target = path.resolve(BASE_DIR, filePath);
    if (!target.startsWith(BASE_DIR + path.sep) && target !== BASE_DIR) {
        throw new Error('Invalid path');
    }

    return target;
}

const resolveAndEnsureFile = (req: MulterRequest): string => {
    const filePath = req.params.path;
    if (!filePath) {
        throw new Error('Missing path');
    }
    const target = resolvePath(filePath);

    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        throw new Error('Not found');
    }

    return target;
};

app.use((req, _res, next) => {
    log(req.ip, req.method, req.originalUrl);
    next();
});

app.put('/files/*path', (req: MulterRequest, res: express.Response) => {
    const filePath = req.params.path;
    if (!filePath) {
        logError('Upload rejected: missing target path', { ip: req.ip, method: req.method, url: req.originalUrl });
        return res.status(400).json({ error: 'Missing target path' });
    }

    try {
        const target = resolvePath(filePath);
        log('Upload attempt (raw stream)', {
            ip: req.ip,
            method: req.method,
            target,
            contentLength: req.headers['content-length'],
        });

        fsPromises
            .mkdir(path.dirname(target), { recursive: true })
            .then(() => {
                const writeStream = fs.createWriteStream(target, { mode: 0o644 });
                let responded = false;

                const handleError = (stage: string, err): void => {
                    logError('Upload failed', {
                        stage,
                        error: err?.message || err,
                        stack: err?.stack,
                        ip: req.ip,
                        url: req.originalUrl,
                        params: req.params,
                    });
                    if (!responded) {
                        responded = true;
                        writeStream.destroy();
                        fsPromises.unlink(target).catch(() => {
                            /* ignore */
                        });
                        res.status(400).json({ error: err?.message || 'Upload failed' });
                    }
                };

                req.on('error', (err) => handleError('request', err));
                writeStream.on('error', (err) => handleError('write', err));

                writeStream.on('finish', () => {
                    if (responded) return;
                    responded = true;
                    log('Upload successful', { target, path: filePath, ip: req.ip });
                    return res.status(201).json({ url: `http://localhost:${PORT}/files/${filePath}`, path: filePath });
                });

                req.pipe(writeStream);
            })
            .catch((err) => {
                logError('Upload preparation failed', { error: err?.message || err, ip: req.ip, url: req.originalUrl });
                return res.status(400).json({ error: err?.message || 'Upload failed' });
            });
    } catch (err) {
        logError('Upload failed (sync)', {
            error: err?.message || err,
            stack: err?.stack,
            ip: req.ip,
            url: req.originalUrl,
            params: req.params,
        });
        return res.status(400).json({ error: err?.message || 'Upload failed' });
    }
});

app.get('/files/*path', async (req: MulterRequest, res: express.Response) => {
    try {
        const target = resolveAndEnsureFile(req);
        log('Serving file', { ip: req.ip, target, params: req.params });
        res.sendFile(target);
    } catch (err) {
        logError('Serve failed', {
            error: err?.message || err,
            stack: err?.stack,
            ip: req.ip,
            url: req.originalUrl,
            params: req.params,
        });
        return res.status(400).json({ error: err?.message || 'Failed to serve file' });
    }
});

app.delete('/files/*path', async (req: MulterRequest, res: express.Response) => {
    try {
        const target = resolveAndEnsureFile(req);
        log('Delete attempt', { ip: req.ip, target, params: req.params });
        await fsPromises.unlink(target);
        log('Delete successful', { target, params: req.params });
        return res.status(204).send();
    } catch (err) {
        logError('Delete failed', {
            error: err?.message || err,
            stack: err?.stack,
            ip: req.ip,
            url: req.originalUrl,
            params: req.params,
        });
        return res.status(400).json({ error: err?.message || 'Failed to delete file' });
    }
});

app.listen(PORT, () => {
    log(`Server listening on port ${PORT}`);
});
