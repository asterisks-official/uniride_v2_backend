import { Injectable } from '@nestjs/common';
import { RidesRepository } from './rides.repository';

@Injectable()
export class RidesService {
  constructor(private readonly ridesRepository: RidesRepository) {}
  // Implemented in Phase 3
}
