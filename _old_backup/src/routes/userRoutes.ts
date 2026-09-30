import { Router } from 'express';
import {
  handleCreateUser,
  handleDeleteUser,
  handleGetUser,
  handleListUsers,
  handleUpdateUser,
} from '../controllers/userController';

export const userRouter = Router();

userRouter.post('/', handleCreateUser);
userRouter.get('/', handleListUsers);
userRouter.get('/:id', handleGetUser);
userRouter.patch('/:id', handleUpdateUser);
userRouter.delete('/:id', handleDeleteUser);
