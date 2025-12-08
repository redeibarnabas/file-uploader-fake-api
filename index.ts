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

function resolvePath(filePath: string): string {
    if (filePath.startsWith('/')) {
        filePath = filePath.slice(1);
    }

    const target = path.resolve(BASE_DIR, filePath);
    if (!target.startsWith(BASE_DIR + path.sep) && target !== BASE_DIR) {
        throw new Error('Invalid path');
    }

    return target;
}

app.post('/files/*path', upload.single('file'), async (req: MulterRequest, res: express.Response) => {
    try {
        const filePath = req.params.path;
        if (!filePath) {
            return res.status(400).json({ error: 'Missing target path' });
        }
        if (!req.file) {
            return res.status(400).json({ error: "Missing file field 'file'" });
        }

        const target = resolvePath(filePath);
        await fsPromises.mkdir(path.dirname(target), { recursive: true });
        await fsPromises.writeFile(target, req.file.buffer, { mode: 0o644 });

        return res.status(201).json({ url: `http://localhost:${PORT}/files/${filePath}`, path: filePath });
    } catch (err) {
        return res.status(400).json({ error: err.message || 'Upload failed' });
    }
});

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

app.get('/files/*path', async (req: MulterRequest, res: express.Response) => {
    try {
        const target = resolveAndEnsureFile(req);

        res.sendFile(target);
    } catch (err) {
        return res.status(400).json({ error: err.message || 'Failed to serve file' });
    }
});

app.delete('/files/*path', async (req: MulterRequest, res: express.Response) => {
    try {
        const target = resolveAndEnsureFile(req);

        await fsPromises.unlink(target);
        return res.status(204).send();
    } catch (err) {
        return res.status(400).json({ error: err.message || 'Failed to delete file' });
    }
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
