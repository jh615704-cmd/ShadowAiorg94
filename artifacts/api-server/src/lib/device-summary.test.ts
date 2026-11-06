import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeUserAgent } from "./device-summary";

test("summarizes a Windows laptop and browser version", () => {
  const summary = summarizeUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  );
  assert.equal(summary.browser, "Chrome 128");
  assert.equal(summary.operating_system, "Windows 10/11");
  assert.equal(summary.device_type, "laptop_desktop");
  assert.equal(summary.form_factor, "desktop");
});

test("recognizes an iPhone and Android tablet separately", () => {
  const phone = summarizeUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  );
  assert.equal(phone.browser, "Safari 17");
  assert.equal(phone.operating_system, "iOS 17.5");
  assert.equal(phone.device_type, "phone");

  const tablet = summarizeUserAgent(
    "Mozilla/5.0 (Linux; Android 14; Pixel C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  );
  assert.equal(tablet.browser, "Chrome 127");
  assert.equal(tablet.operating_system, "Android 14");
  assert.equal(tablet.device_type, "tablet");
});

test("keeps unknown user agents in the other category", () => {
  const summary = summarizeUserAgent(null);
  assert.equal(summary.browser, "Unknown browser");
  assert.equal(summary.operating_system, "Unknown operating system");
  assert.equal(summary.device_type, "other");
  assert.equal(summary.form_factor, "other");
});
