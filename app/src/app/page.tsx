/**
 * Standalone landing page. The real work happens in the custom field at
 * /field, which Sitecore hosts inside the field editor; this exists so the
 * deployed root URL explains itself rather than 404ing.
 */
export default function Home() {
  return (
    <main>
      <h1>QuickTable</h1>
      <p className="note">
        This app runs inside Sitecore. Register it as a custom field pointing at{' '}
        <code>/field</code>, then open a QuickTable datasource to use it.
      </p>
    </main>
  );
}
