/**
 * Markdown Builder for Wiki Help Generator Skill
 * Generates structured wiki articles following the 3-step pattern
 */

export interface ImageReference {
  filename: string;
  altText: string;
  description?: string;
}

export interface ActionSection {
  title: string;
  description: string;
  images?: ImageReference[];
  details?: string[];
}

export interface WikiArticleContent {
  title: string;
  whatIsThis: {
    description: string;
    prerequisites?: string[];
    relatedArticles?: Array<{ text: string; slug: string }>;
  };
  whatCanYouDo: {
    actions: Array<{ name: string; description: string }>;
  };
  whatHappens: {
    sections: ActionSection[];
  };
}

export class MarkdownBuilder {
  /**
   * Build complete wiki article markdown
   */
  static buildArticle(content: WikiArticleContent): string {
    const lines: string[] = [];

    // Title
    lines.push(`# ${content.title}\n`);

    // Step 1: What is this page?
    lines.push('## What is this page?\n');
    lines.push(content.whatIsThis.description);
    lines.push('');

    if (content.whatIsThis.prerequisites && content.whatIsThis.prerequisites.length > 0) {
      lines.push('Before using this page, make sure:');
      lines.push('');
      content.whatIsThis.prerequisites.forEach((prereq) => {
        lines.push(`- ${prereq}`);
      });
      lines.push('');
    }

    if (
      content.whatIsThis.relatedArticles &&
      content.whatIsThis.relatedArticles.length > 0
    ) {
      lines.push('For more information, see:');
      lines.push('');
      content.whatIsThis.relatedArticles.forEach((article) => {
        lines.push(`- [${article.text}](/help/${article.slug})`);
      });
      lines.push('');
    }

    // Step 2: What can you do?
    lines.push('## What can you do?\n');
    content.whatCanYouDo.actions.forEach((action) => {
      lines.push(`- **${action.name}** - ${action.description}`);
    });
    lines.push('');

    // Step 3: What happens when you do each action?
    lines.push('## What happens when you do each action?\n');

    content.whatHappens.sections.forEach((section) => {
      lines.push(`### ${section.title}\n`);
      lines.push(section.description);
      lines.push('');

      if (section.images && section.images.length > 0) {
        section.images.forEach((image) => {
          lines.push(
            `![${image.altText}](/api/public/wiki/images/${image.filename})`,
          );
          lines.push('');

          if (image.description) {
            lines.push(`*${image.description}*`);
            lines.push('');
          }
        });
      }

      if (section.details && section.details.length > 0) {
        section.details.forEach((detail) => {
          lines.push(detail);
        });
        lines.push('');
      }
    });

    return lines.join('\n').trim() + '\n';
  }

  /**
   * Build a simple article with minimal structure
   */
  static buildSimpleArticle(
    title: string,
    whatIsThis: string,
    whatCanYouDo: string[],
    actions: Array<{ name: string; description: string; images?: ImageReference[] }>,
  ): string {
    const content: WikiArticleContent = {
      title,
      whatIsThis: {
        description: whatIsThis,
      },
      whatCanYouDo: {
        actions: actions.map((a) => ({
          name: a.name,
          description: a.description || '',
        })),
      },
      whatHappens: {
        sections: actions.map((action) => ({
          title: action.name,
          description: `When you ${action.name.toLowerCase()}:`,
          images: action.images || [],
        })),
      },
    };

    return this.buildArticle(content);
  }

  /**
   * Add image to markdown
   */
  static createImageMarkdown(
    filename: string,
    altText: string,
    caption?: string,
  ): string {
    const img = `![${altText}](/api/public/wiki/images/${filename})`;
    if (caption) {
      return `${img}\n\n*${caption}*`;
    }
    return img;
  }

  /**
   * Create a link to another help article
   */
  static createHelpLink(text: string, slug: string): string {
    return `[${text}](/help/${slug})`;
  }

  /**
   * Create a formatted list
   */
  static createList(items: string[], ordered = false): string {
    return items
      .map((item, index) => {
        const prefix = ordered ? `${index + 1}.` : '-';
        return `${prefix} ${item}`;
      })
      .join('\n');
  }

  /**
   * Create a code block
   */
  static createCodeBlock(code: string, language = ''): string {
    return `\`\`\`${language}\n${code}\n\`\`\``;
  }

  /**
   * Create a blockquote
   */
  static createBlockquote(text: string): string {
    const lines = text.split('\n');
    return lines.map((line) => `> ${line}`).join('\n');
  }

  /**
   * Create a table
   */
  static createTable(headers: string[], rows: string[][]): string {
    const headerRow = `| ${headers.join(' | ')} |`;
    const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
    const dataRows = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');

    return `${headerRow}\n${separatorRow}\n${dataRows}`;
  }

  /**
   * Create a horizontal rule
   */
  static createHorizontalRule(): string {
    return '---';
  }

  /**
   * Format text as bold
   */
  static bold(text: string): string {
    return `**${text}**`;
  }

  /**
   * Format text as italic
   */
  static italic(text: string): string {
    return `*${text}*`;
  }

  /**
   * Format text as code
   */
  static code(text: string): string {
    return `\`${text}\``;
  }

  /**
   * Create a heading
   */
  static heading(text: string, level = 2): string {
    const hashes = '#'.repeat(level);
    return `${hashes} ${text}`;
  }

  /**
   * Validate markdown syntax
   */
  static validateMarkdown(markdown: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for balanced brackets
    const linkPattern = /\[([^\]]*)\]\(([^)]*)\)/g;
    const matches = markdown.match(linkPattern) || [];

    // Check for unclosed formatting
    const boldPattern = /\*\*/g;
    const boldCount = (markdown.match(boldPattern) || []).length;
    if (boldCount % 2 !== 0) {
      errors.push('Unclosed bold (**) formatting');
    }

    const italicPattern = /(?<!\*)\*(?!\*)/g;
    const italicCount = (markdown.match(italicPattern) || []).length;
    if (italicCount % 2 !== 0) {
      errors.push('Unclosed italic (*) formatting');
    }

    // Check for image URLs
    const imgPattern = /!\[([^\]]*)\]\(\/api\/public\/wiki\/images\/([^)]*)\)/g;
    const imgMatches = markdown.match(imgPattern) || [];
    if (imgMatches.length === 0 && markdown.includes('](/api/public/wiki/images/')) {
      errors.push('Image URL format may be incorrect');
    }

    // Check for help links
    const helpPattern = /\[([^\]]*)\]\(\/help\/([^)]*)\)/g;
    const helpMatches = markdown.match(helpPattern) || [];

    // No HTML tags allowed
    const htmlPattern = /<[^>]*>/g;
    const htmlMatches = markdown.match(htmlPattern) || [];
    if (htmlMatches.length > 0) {
      errors.push(`HTML tags found (not allowed): ${htmlMatches.join(', ')}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Example usage:
 *
 * const article = MarkdownBuilder.buildArticle({
 *   title: 'Matches',
 *   whatIsThis: {
 *     description: 'The Matches page shows all ranked matches played in the tournament.',
 *     prerequisites: [
 *       'You must be logged in',
 *       'You must have played at least one ranked match'
 *     ]
 *   },
 *   whatCanYouDo: {
 *     actions: [
 *       { name: 'View Match', description: 'See details of a completed match' },
 *       { name: 'Confirm Match', description: 'Confirm a preliminary match result' }
 *     ]
 *   },
 *   whatHappens: {
 *     sections: [
 *       {
 *         title: 'View Match Details',
 *         description: 'Click on any match to see full details...',
 *         images: [
 *           {
 *             filename: '1781817452133_xqy1fp.png',
 *             altText: 'Match details view',
 *             description: 'Shows all match information including players, result, and ELO changes'
 *           }
 *         ]
 *       }
 *     ]
 *   }
 * });
 *
 * // Validate the markdown
 * const { valid, errors } = MarkdownBuilder.validateMarkdown(article);
 * if (!valid) {
 *   console.error('Markdown errors:', errors);
 * }
 */
