import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Reads the runtime `app_config` key/value table.
 *
 * The point of the table is that pricing constants can be corrected without a
 * deploy. The point of the cache is that a quote must not cost a database
 * round-trip per constant — the compose screen re-quotes on every input change.
 *
 * A short TTL rather than an invalidation hook: a wrong fare coefficient is a
 * revenue bug someone will want fixed in minutes, not instantly, and a minute
 * of staleness is a fair price for having no cache-busting to get wrong.
 */
@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);
  private cache = new Map<string, string>();
  private loadedAt = 0;

  private static readonly TTL_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async getNumber(key: string, fallback: number): Promise<number> {
    const raw = await this.get(key);
    if (raw === undefined) return fallback;

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      // A typo in the config table must not take pricing down. Fall back and
      // say so loudly enough that someone fixes the row.
      this.logger.error(
        `app_config["${key}"] is "${raw}", which is not a number. Using ${fallback}.`,
      );
      return fallback;
    }
    return parsed;
  }

  private async get(key: string): Promise<string | undefined> {
    if (Date.now() - this.loadedAt > AppConfigService.TTL_MS) {
      await this.refresh();
    }
    return this.cache.get(key);
  }

  private async refresh(): Promise<void> {
    try {
      const rows = await this.prisma.appConfig.findMany();
      this.cache = new Map(rows.map((r) => [r.key, r.value]));
      this.loadedAt = Date.now();
    } catch (err) {
      // Keep serving the last known values rather than failing every quote.
      this.loadedAt = Date.now();
      this.logger.error('Could not refresh app_config; serving stale', err);
    }
  }
}
