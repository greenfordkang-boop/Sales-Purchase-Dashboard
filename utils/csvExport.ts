
export const downloadCSV = (filename: string, headers: string[], rows: (string | number | undefined | null)[][]) => {
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => {
      if (cell === null || cell === undefined) return '';
      const str = String(cell);
      // Escape quotes and wrap in quotes if contains comma, quote or newline
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(','))
  ].join('\n');

  // Add BOM (Byte Order Mark) for Excel UTF-8 compatibility
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  document.body.appendChild(link);
  
  link.click();
  
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
