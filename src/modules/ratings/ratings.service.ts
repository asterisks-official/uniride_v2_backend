import { Injectable } from '@nestjs/common';
import { RatingsRepository } from './ratings.repository';

@Injectable()
export class RatingsService {
  constructor(private readonly ratingsRepository: RatingsRepository) {}
  // Implemented in Phase 3
}
