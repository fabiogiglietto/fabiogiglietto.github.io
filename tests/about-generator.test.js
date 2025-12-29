/**
 * Tests for about-generator.js
 *
 * Tests HTML sanitization and content generation utilities.
 */

const sanitizeHtml = require('sanitize-html');

// Test the sanitization configuration used in about-generator
const sanitizeConfig = {
  allowedTags: ['p', 'strong', 'em', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'br', 'div', 'section'],
  allowedAttributes: {
    'a': ['href', 'target', 'rel']
  },
  allowedSchemes: ['http', 'https', 'mailto']
};

describe('HTML Sanitization', () => {
  describe('allowed tags', () => {
    test('allows paragraph tags', () => {
      const input = '<p>Hello world</p>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe(input);
    });

    test('allows formatting tags', () => {
      const input = '<p><strong>Bold</strong> and <em>italic</em></p>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe(input);
    });

    test('allows links with safe attributes', () => {
      const input = '<a href="https://example.com" target="_blank" rel="noopener">Link</a>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe(input);
    });

    test('allows lists', () => {
      const input = '<ul><li>Item 1</li><li>Item 2</li></ul>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe(input);
    });

    test('allows headings h2-h4', () => {
      const input = '<h2>Title</h2><h3>Subtitle</h3><h4>Section</h4>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe(input);
    });
  });

  describe('blocked content', () => {
    test('removes script tags', () => {
      const input = '<p>Safe</p><script>alert("xss")</script>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<p>Safe</p>');
    });

    test('removes onclick handlers', () => {
      const input = '<p onclick="alert(1)">Text</p>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<p>Text</p>');
    });

    test('removes javascript: URLs', () => {
      const input = '<a href="javascript:alert(1)">Click</a>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<a>Click</a>');
    });

    test('removes data: URLs', () => {
      const input = '<a href="data:text/html,<script>alert(1)</script>">Click</a>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<a>Click</a>');
    });

    test('removes style tags', () => {
      const input = '<style>body{display:none}</style><p>Content</p>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<p>Content</p>');
    });

    test('removes iframe tags', () => {
      const input = '<iframe src="https://evil.com"></iframe><p>Safe</p>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<p>Safe</p>');
    });

    test('removes img tags', () => {
      const input = '<img src="x" onerror="alert(1)"><p>Text</p>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<p>Text</p>');
    });

    test('removes h1 tags (not in allowed list)', () => {
      const input = '<h1>Big Title</h1>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('Big Title');
    });
  });

  describe('URL schemes', () => {
    test('allows https URLs', () => {
      const input = '<a href="https://example.com">Link</a>';
      expect(sanitizeHtml(input, sanitizeConfig)).toContain('https://example.com');
    });

    test('allows http URLs', () => {
      const input = '<a href="http://example.com">Link</a>';
      expect(sanitizeHtml(input, sanitizeConfig)).toContain('http://example.com');
    });

    test('allows mailto URLs', () => {
      const input = '<a href="mailto:test@example.com">Email</a>';
      expect(sanitizeHtml(input, sanitizeConfig)).toContain('mailto:test@example.com');
    });

    test('blocks ftp URLs', () => {
      const input = '<a href="ftp://example.com/file">Download</a>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<a>Download</a>');
    });
  });

  describe('nested content', () => {
    test('handles deeply nested safe content', () => {
      const input = '<div><section><p><strong><em>Nested</em></strong></p></section></div>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe(input);
    });

    test('removes dangerous nested content', () => {
      const input = '<div><p>Safe<script>alert(1)</script>Content</p></div>';
      expect(sanitizeHtml(input, sanitizeConfig)).toBe('<div><p>SafeContent</p></div>');
    });
  });
});
