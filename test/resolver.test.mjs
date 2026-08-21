import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, isStable, parseVersions, metadataUrl } from '../src/resolver.mjs';

test('numeric compare, not lexicographic', () => {
  assert.ok(compareVersions('2.8.10', '2.8.4') > 0, '2.8.10 must beat 2.8.4');
  assert.ok(compareVersions('1.19.0', '1.9.0') > 0);
  assert.equal(compareVersions('3.0.0', '3.0.0'), 0);
});

test('CalVer sorts correctly', () => {
  assert.ok(compareVersions('2026.08.00', '2026.06.01') > 0);
  assert.ok(compareVersions('2026.01.00', '2025.12.01') > 0);
});

test('prerelease rejection covers every real-world shape seen on Maven', () => {
  for (const v of ['2.4.20-RC', '9.5.0-alpha02', '1.3.0-rc01', '2.12.0-alpha01',
                   '4.13-rc-2', '2.8.0-beta01', '1.0.0-SNAPSHOT', '2.0.0-M1',
                   '1.9.0-eap-2', '2.7.0-dev-1']) {
    assert.equal(isStable(v), false, `${v} must be rejected`);
  }
  for (const v of ['2.4.10', '9.3.1', '2026.08.00', '2.60.1', '4.13.2', '3.0.0']) {
    assert.equal(isStable(v), true, `${v} must be accepted`);
  }
});

test('repo paths are built correctly', () => {
  assert.equal(metadataUrl('google', 'androidx.room', 'room-runtime'),
    'https://dl.google.com/dl/android/maven2/androidx/room/room-runtime/maven-metadata.xml');
  assert.equal(metadataUrl('central', 'com.google.dagger', 'hilt-android'),
    'https://repo1.maven.org/maven2/com/google/dagger/hilt-android/maven-metadata.xml');
  assert.throws(() => metadataUrl('jcenter', 'a.b', 'c'), /unknown repo/);
});

test('metadata parsing', () => {
  const xml = '<metadata><versioning><versions><version>1.0.0</version><version>1.1.0</version></versions></versioning></metadata>';
  assert.deepEqual(parseVersions(xml), ['1.0.0', '1.1.0']);
  assert.deepEqual(parseVersions('<metadata/>'), []);
});
