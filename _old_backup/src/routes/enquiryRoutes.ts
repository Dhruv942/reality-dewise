import { Router } from 'express';
import {
  handleConvertToLead,
  handleCreateEnquiry,
  handleFindMatchingProperties,
  handleGetEnquiry,
  handleListEnquiries,
  handleUpdateEnquiry,
} from '../controllers/enquiryController';

export const enquiryRouter = Router();

enquiryRouter.post('/', handleCreateEnquiry);
enquiryRouter.get('/', handleListEnquiries);
enquiryRouter.get('/:id', handleGetEnquiry);
enquiryRouter.patch('/:id', handleUpdateEnquiry);
enquiryRouter.get('/:id/matching-properties', handleFindMatchingProperties);
enquiryRouter.post('/:id/convert-to-lead', handleConvertToLead);
