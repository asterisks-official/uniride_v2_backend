import { UserRole } from '@prisma/client';
import { parseUploadKey, canViewUpload } from './uploads.service';

const OWNER = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const OTHER = '9c858901-8a57-4791-81fe-4c455b099bc9';

const passenger = { userId: OTHER, role: UserRole.PASSENGER };
const owner = { userId: OWNER, role: UserRole.PASSENGER };
const admin = { userId: OTHER, role: UserRole.ADMIN };
const superAdmin = { userId: OTHER, role: UserRole.SUPER_ADMIN };

describe('parseUploadKey', () => {
  it('accepts a bare key as minted by presign', () => {
    expect(parseUploadKey(`license/${OWNER}/abc-1.jpg`)).toEqual({
      key: `license/${OWNER}/abc-1.jpg`,
      folder: 'license',
      ownerId: OWNER,
    });
  });

  it('accepts the S3 URL stored in license_doc_url', () => {
    // The database holds full URLs, not keys. Rejecting them would have meant
    // a migration before the verification queue could show anything.
    const stored = `https://uniride-uploads-prod.s3.ap-southeast-1.amazonaws.com/selfie/${OWNER}/x.png`;
    expect(parseUploadKey(stored)?.key).toBe(`selfie/${OWNER}/x.png`);
  });

  it('accepts the dev URL, which carries the key in a query parameter', () => {
    const dev = `http://localhost:3000/api/v1/uploads/dev-object?key=${encodeURIComponent(
      `student_id/${OWNER}/y.pdf`,
    )}`;
    expect(parseUploadKey(dev)?.key).toBe(`student_id/${OWNER}/y.pdf`);
  });

  it('rejects a folder outside the upload allowlist', () => {
    // Otherwise any object in the bucket becomes readable by naming it.
    expect(parseUploadKey(`backups/${OWNER}/dump.sql`)).toBeNull();
  });

  it('rejects traversal out of the owner prefix', () => {
    expect(parseUploadKey(`license/${OWNER}/../../etc/passwd`)).toBeNull();
  });

  it('rejects a key whose owner segment is not a uuid', () => {
    // The owner segment is the entire authorisation check, so a key that does
    // not carry one must never reach the signer.
    expect(parseUploadKey('license/admin/x.jpg')).toBeNull();
  });

  it('rejects empty and malformed input', () => {
    expect(parseUploadKey('')).toBeNull();
    expect(parseUploadKey('   ')).toBeNull();
    expect(parseUploadKey('license')).toBeNull();
    expect(parseUploadKey('http://[::bad')).toBeNull();
  });
});

describe('canViewUpload', () => {
  it('lets the owner read their own document', () => {
    expect(canViewUpload(OWNER, owner)).toBe(true);
  });

  it('lets an admin read anyone’s, because that is what review means', () => {
    expect(canViewUpload(OWNER, admin)).toBe(true);
    expect(canViewUpload(OWNER, superAdmin)).toBe(true);
  });

  it('refuses another passenger', () => {
    // The gap this closes: licences and national ID cards were reachable to
    // anyone who could guess or obtain a key, once a view route existed.
    expect(canViewUpload(OWNER, passenger)).toBe(false);
  });

  it('refuses a rider who is not the owner', () => {
    expect(canViewUpload(OWNER, { userId: OTHER, role: UserRole.RIDER })).toBe(
      false,
    );
  });
});
