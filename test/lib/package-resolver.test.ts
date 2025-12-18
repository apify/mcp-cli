/**
 * Unit tests for package resolution
 */

import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { resolvePackage, createPackageTransport } from '../../src/lib/package-resolver';
import { ClientError } from '../../src/lib/errors';

const TEST_DIR = join(process.cwd(), 'test-tmp-packages');
const NODE_MODULES = join(TEST_DIR, 'node_modules');

beforeAll(() => {
  // Create test directory structure
  mkdirSync(NODE_MODULES, { recursive: true });
});

afterAll(() => {
  // Clean up test directory
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('resolvePackage', () => {
  beforeEach(() => {
    // Save original cwd and change to test directory
    process.chdir(TEST_DIR);
  });

  afterEach(() => {
    // Restore original cwd
    process.chdir(process.cwd().replace(/test-tmp-packages$/, ''));
  });

  it('should resolve package with bin field (string)', () => {
    const packageName = 'test-package-bin-string';
    const packageDir = join(NODE_MODULES, packageName);

    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: packageName,
        version: '1.0.0',
        bin: 'cli.js',
      })
    );
    writeFileSync(join(packageDir, 'cli.js'), '// Test executable');

    const pkg = resolvePackage(packageName);

    expect(pkg.name).toBe(packageName);
    expect(pkg.version).toBe('1.0.0');
    expect(pkg.executable).toContain('cli.js');
  });

  it('should resolve package with bin field (object)', () => {
    const packageName = 'test-package-bin-object';
    const packageDir = join(NODE_MODULES, packageName);

    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: packageName,
        version: '1.0.0',
        bin: {
          [packageName]: 'bin/cli.js',
          other: 'bin/other.js',
        },
      })
    );
    mkdirSync(join(packageDir, 'bin'), { recursive: true });
    writeFileSync(join(packageDir, 'bin/cli.js'), '// Test executable');
    writeFileSync(join(packageDir, 'bin/other.js'), '// Other executable');

    const pkg = resolvePackage(packageName);

    expect(pkg.name).toBe(packageName);
    expect(pkg.executable).toContain('bin/cli.js');
  });

  it('should resolve package with main field', () => {
    const packageName = 'test-package-main';
    const packageDir = join(NODE_MODULES, packageName);

    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: packageName,
        version: '1.0.0',
        main: 'index.js',
      })
    );
    writeFileSync(join(packageDir, 'index.js'), '// Test main');

    const pkg = resolvePackage(packageName);

    expect(pkg.name).toBe(packageName);
    expect(pkg.executable).toContain('index.js');
  });

  it('should resolve package with mcpServer field', () => {
    const packageName = 'test-package-mcp';
    const packageDir = join(NODE_MODULES, packageName);

    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: packageName,
        version: '1.0.0',
        mcpServer: 'server.js',
        main: 'index.js', // Should prefer mcpServer over main
      })
    );
    writeFileSync(join(packageDir, 'server.js'), '// MCP server');
    writeFileSync(join(packageDir, 'index.js'), '// Main');

    const pkg = resolvePackage(packageName);

    expect(pkg.name).toBe(packageName);
    expect(pkg.executable).toContain('server.js');
  });

  it('should fallback to common defaults', () => {
    const packageName = 'test-package-default';
    const packageDir = join(NODE_MODULES, packageName);

    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: packageName,
        version: '1.0.0',
      })
    );
    writeFileSync(join(packageDir, 'index.js'), '// Default index');

    const pkg = resolvePackage(packageName);

    expect(pkg.name).toBe(packageName);
    expect(pkg.executable).toContain('index.js');
  });

  it('should throw on non-existent package', () => {
    expect(() => resolvePackage('non-existent-package')).toThrow(ClientError);
    expect(() => resolvePackage('non-existent-package')).toThrow('Package not found');
  });

  it('should throw on package without executable', () => {
    const packageName = 'test-package-no-exec';
    const packageDir = join(NODE_MODULES, packageName);

    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: packageName,
        version: '1.0.0',
      })
    );
    // Don't create any executable files

    expect(() => resolvePackage(packageName)).toThrow(ClientError);
    expect(() => resolvePackage(packageName)).toThrow('Could not determine executable');
  });

  it('should handle scoped packages', () => {
    const packageName = '@scope/test-package';
    const packageDir = join(NODE_MODULES, '@scope', 'test-package');

    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: packageName,
        version: '1.0.0',
        bin: 'cli.js',
      })
    );
    writeFileSync(join(packageDir, 'cli.js'), '// Scoped package');

    const pkg = resolvePackage(packageName);

    expect(pkg.name).toBe(packageName);
    expect(pkg.executable).toContain('cli.js');
  });

  it('should use short name for bin lookup in scoped packages', () => {
    const packageName = '@scope/test-package';
    const packageDir = join(NODE_MODULES, '@scope', 'test-package');

    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      join(packageDir, 'package.json'),
      JSON.stringify({
        name: packageName,
        version: '1.0.0',
        bin: {
          'test-package': 'cli.js', // Short name matches
        },
      })
    );
    writeFileSync(join(packageDir, 'cli.js'), '// Scoped package');

    const pkg = resolvePackage(packageName);

    expect(pkg.name).toBe(packageName);
    expect(pkg.executable).toContain('cli.js');
  });
});

describe('createPackageTransport', () => {
  it('should create stdio transport with node command', () => {
    const pkg = {
      name: 'test-package',
      version: '1.0.0',
      path: '/path/to/package',
      executable: '/path/to/package/cli.js',
      packageJson: { name: 'test-package' },
    };

    const transport = createPackageTransport(pkg);

    expect(transport.type).toBe('stdio');
    expect(transport.command).toBe('node');
    expect(transport.args).toEqual(['/path/to/package/cli.js']);
  });

  it('should include additional args', () => {
    const pkg = {
      name: 'test-package',
      version: '1.0.0',
      path: '/path/to/package',
      executable: '/path/to/package/cli.js',
      packageJson: { name: 'test-package' },
    };

    const transport = createPackageTransport(pkg, ['--flag', 'value']);

    expect(transport.args).toEqual(['/path/to/package/cli.js', '--flag', 'value']);
  });

  it('should include environment variables', () => {
    const pkg = {
      name: 'test-package',
      version: '1.0.0',
      path: '/path/to/package',
      executable: '/path/to/package/cli.js',
      packageJson: { name: 'test-package' },
    };

    const transport = createPackageTransport(pkg, undefined, { DEBUG: '1' });

    expect(transport.env).toEqual({ DEBUG: '1' });
  });

  it('should not include env if not provided', () => {
    const pkg = {
      name: 'test-package',
      version: '1.0.0',
      path: '/path/to/package',
      executable: '/path/to/package/cli.js',
      packageJson: { name: 'test-package' },
    };

    const transport = createPackageTransport(pkg);

    expect(transport.env).toBeUndefined();
  });
});
