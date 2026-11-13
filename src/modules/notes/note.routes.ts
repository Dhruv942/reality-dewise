import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { authenticate } from '../auth/auth.middleware';
import * as c from './note.controller';
import { createNoteSchema, updateNoteSchema } from './note.validation';

/** /api/v1/notes: any logged-in user, always and only their own notes. */
export const noteRouter = Router();

noteRouter.use(authenticate());
noteRouter.get('/', c.list);
noteRouter.post('/', validateBody(createNoteSchema), c.create);
noteRouter.get('/:id', c.get);
noteRouter.patch('/:id', validateBody(updateNoteSchema), c.update);
noteRouter.delete('/:id', c.remove);
