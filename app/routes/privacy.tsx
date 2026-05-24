// Public privacy policy page — linked from the Shopify App Store listing.
// Must be reachable without auth so Shopify's review team can read it.

import type { MetaFunction } from "@remix-run/node";

export const meta: MetaFunction = () => [
  { title: "Privacy Policy — Emilia AI Studio" },
  { name: "robots", content: "index,follow" },
];

const LAST_UPDATED = "May 24, 2026";
const CONTACT_EMAIL = "aistudio@emilia.digital";

export default function Privacy() {
  return (
    <main
      style={{
        maxWidth: "780px",
        margin: "0 auto",
        padding: "48px 24px 96px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        color: "#1f2328",
        lineHeight: 1.6,
      }}
    >
      <header style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "32px", margin: "0 0 8px" }}>Privacy Policy</h1>
        <p style={{ color: "#656d76", margin: 0 }}>
          Emilia AI Studio for Shopify · Last updated {LAST_UPDATED}
        </p>
      </header>

      <Section title="Who we are">
        <p>
          Emilia AI Studio (&ldquo;Emilia&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) provides
          AI-powered product image enhancement for Shopify merchants. The Shopify
          app communicates with our hosted enhancement service at{" "}
          <code>ai.emilia.digital</code>.
        </p>
        <p>
          For questions about this policy or your data, contact{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </Section>

      <Section title="What data we collect">
        <p>When you install and use the Shopify app, we store:</p>
        <ul>
          <li>
            <strong>Shop identifier</strong> — your <code>*.myshopify.com</code>{" "}
            domain, used to scope your settings.
          </li>
          <li>
            <strong>Shopify session token</strong> — issued by Shopify so the app
            can call the Admin API on your behalf.
          </li>
          <li>
            <strong>Your Emilia API key</strong> (the <code>eak_</code> key you
            paste in Settings) — required to authenticate with the Emilia
            enhancement service.
          </li>
          <li>
            <strong>Default enhancement preferences</strong> — chosen style,
            aspect ratio, resolution, and presenter values you select in
            Settings.
          </li>
          <li>
            <strong>Cached platform configuration</strong> — the list of
            available styles, aspects, resolutions, and presenters returned by
            the Emilia API, cached briefly to reduce API calls.
          </li>
        </ul>
        <p>
          We do <strong>not</strong> collect, store, or process any{" "}
          <em>customer</em> data from your store (no names, emails, addresses,
          orders, or payment information).
        </p>
      </Section>

      <Section title="What data we send to the Emilia enhancement service">
        <p>
          When you enhance a product image (individually from a product page, via
          the admin action extension, or in bulk), the app sends the following to{" "}
          <code>ai.emilia.digital</code>:
        </p>
        <ul>
          <li>The Shopify-hosted URL of the product image you chose to enhance.</li>
          <li>
            The enhancement parameters you selected (style, aspect ratio,
            resolution, presenter, optional helper overrides).
          </li>
          <li>
            Your Emilia API key in the <code>Authorization</code> header for
            authentication and quota tracking.
          </li>
        </ul>
        <p>
          The enhancement service downloads the source image, generates the
          enhanced version, and returns the result. We do not link this activity
          to any individual customer of your store.
        </p>
      </Section>

      <Section title="How we use the data">
        <ul>
          <li>To authenticate the Shopify app with your store (session tokens).</li>
          <li>To authenticate enhancement requests against your Emilia account (API key).</li>
          <li>To apply your saved defaults so the UI is consistent across sessions.</li>
          <li>To meter usage against your Emilia plan quota.</li>
        </ul>
        <p>
          We do not sell, rent, or share your data with third parties for
          marketing purposes. We do not use your product images or settings to
          train external models without your explicit consent.
        </p>
      </Section>

      <Section title="Where the data lives">
        <ul>
          <li>
            <strong>App database</strong> — MySQL on a server we control
            (Cloudways / DigitalOcean infrastructure, EU region). Stores shop
            domain, session, API key, defaults, and config cache.
          </li>
          <li>
            <strong>Enhancement service</strong> — <code>ai.emilia.digital</code>{" "}
            (our hosted platform). Processes image enhancement requests.
          </li>
          <li>
            <strong>Shopify Admin API</strong> — we read your products and
            product images, upload enhanced images back to your store, and
            reorder/replace media as you instruct.
          </li>
        </ul>
      </Section>

      <Section title="Retention and deletion">
        <p>
          When you <strong>uninstall</strong> the app from your Shopify admin,
          our uninstall webhook immediately deletes:
        </p>
        <ul>
          <li>Your Shopify session token.</li>
          <li>Your Emilia API key.</li>
          <li>Your stored defaults and cached configuration.</li>
        </ul>
        <p>
          As an additional safeguard, Shopify also calls our{" "}
          <code>shop/redact</code> webhook 48 hours after uninstall, which
          re-runs the same cleanup.
        </p>
        <p>
          To delete your data at any time without uninstalling, email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </Section>

      <Section title="GDPR &amp; data subject rights">
        <p>
          Because we do not store customer-level data from your store, the
          Shopify GDPR webhooks <code>customers/data_request</code> and{" "}
          <code>customers/redact</code> return an acknowledgement with no data
          to disclose or delete on our end.
        </p>
        <p>
          If you are an EU/UK data subject and believe we hold information about
          you (for example, if you are a Shopify merchant whose shop domain or
          contact details we have stored), you have the right to access,
          correct, or delete that information. Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will
          respond within 30 days.
        </p>
      </Section>

      <Section title="Security">
        <ul>
          <li>All data in transit is encrypted via HTTPS / TLS.</li>
          <li>
            API keys are stored in our database and used only to authenticate
            requests to the Emilia enhancement service.
          </li>
          <li>
            Access to our infrastructure is restricted to authorised personnel
            and protected by SSH key authentication.
          </li>
        </ul>
      </Section>

      <Section title="Children">
        <p>
          The app is intended for use by Shopify merchants operating commercial
          stores and is not directed at children under 16.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We may update this policy from time to time. The &ldquo;Last
          updated&rdquo; date at the top of the page reflects the most recent
          revision. Material changes will be communicated by email to the
          contact on file for your Emilia account.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Emilia AI Studio
          <br />
          Email: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          <br />
          Web: <a href="https://ai.emilia.digital">ai.emilia.digital</a>
        </p>
      </Section>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: "32px" }}>
      <h2 style={{ fontSize: "20px", margin: "0 0 12px" }}>{title}</h2>
      {children}
    </section>
  );
}
