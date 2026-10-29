import type { Metadata } from 'next';
import { BRAND } from '@/lib/converters/registry';

export const metadata: Metadata = {
  title: 'Contact Us',
  description: `Contact ${BRAND}: request a new converter, report a bug, or just say hello.`,
  alternates: { canonical: '/contact/' },
};

export default function Contact() {
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Contact us</h1>
        <p className="lead">
          Found a bug? Need a converter we do not have yet? We read everything.
        </p>
      </div>
      <section className="prose">
        <h2>What to include</h2>
        <ul>
          <li><strong>New converter requests:</strong> tell us the exact formats (e.g. "TIFF to JPG"). The most-requested ones get built first.</li>
          <li><strong>Bug reports:</strong> which converter, what file type, and what went wrong. A sample file helps — but please never send anything sensitive.</li>
          <li><strong>Anything else:</strong> feedback, ideas, or just saying the site helped you.</li>
        </ul>
        <h2>Email</h2>
        <p>
          Write to us at{' '}
          <a href="mailto:hello@quickfilesconverter.com">hello@quickfilesconverter.com</a>.
          We reply to genuine messages, usually within a few days.
        </p>
        <div className="alert ok">
          Please do not attach private files to your email — describe the issue
          in words instead. Remember: the converters themselves never need your
          files to leave your device.
        </div>
      </section>
    </div>
  );
}
