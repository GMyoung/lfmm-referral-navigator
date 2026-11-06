"use strict";

function directoryContactInfo(provider, office) {
  return {
    phone: office?.phone || (provider.phone !== "Not provided" ? provider.phone : ""),
    fax: office?.fax || (provider.fax !== "Not provided" ? provider.fax : ""),
    emails: [...new Set(provider.publicEmails || [])]
  };
}

function directoryContactSection(provider, office) {
  const info = directoryContactInfo(provider, office);
  if (!info.phone && !info.fax && !info.emails.length && !provider.officeNotes) return "";
  return '<section class="detail-section office-contacts"><h3>Office contacts</h3>' +
    (info.phone ? '<p class="detail-fact"><span>Phone</span><a href="tel:' + info.phone.replace(/[^\d+]/g, '') + '">' + escapeHtml(info.phone) + '</a></p>' : '') +
    (info.fax ? '<p class="detail-fact"><span>Fax</span>' + escapeHtml(info.fax) + '</p>' : '') +
    info.emails.map(email => '<p class="detail-fact"><span>Email</span><span class="contact-email">' + escapeHtml(email) + '</span></p>').join('') +
    (provider.officeNotes ? '<div class="office-contact-notes">' + escapeHtml(provider.officeNotes) + '</div>' : '') + '</section>';
}
