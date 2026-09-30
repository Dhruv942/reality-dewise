import { Router } from 'express';
import { handleContactLead } from '../controllers/contactController';
import { handleCreateFollowUp, handleListLeadFollowUps } from '../controllers/followUpController';
import {
  handleAssignLead,
  handleCreateLead,
  handleGetLead,
  handleGetLeadHistory,
  handleListLeads,
  handleUpdateLeadStatus,
} from '../controllers/leadController';
import { handleAddNote, handleListNotes } from '../controllers/noteController';

export const leadRouter = Router();

leadRouter.post('/', handleCreateLead);
leadRouter.get('/', handleListLeads);
leadRouter.get('/:id', handleGetLead);
leadRouter.get('/:id/history', handleGetLeadHistory);
leadRouter.patch('/:id/status', handleUpdateLeadStatus);
leadRouter.post('/:id/contact', handleContactLead);
leadRouter.post('/:id/assign', handleAssignLead);

// Notes nested routes
leadRouter.post('/:id/notes', handleAddNote);
leadRouter.get('/:id/notes', handleListNotes);

// Follow-ups nested routes
leadRouter.post('/:id/follow-ups', handleCreateFollowUp);
leadRouter.get('/:id/follow-ups', handleListLeadFollowUps);
