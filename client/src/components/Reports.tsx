import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Card,
  CardContent,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  Tooltip,
  CircularProgress,
  Grid,
  Divider,
  List,
  ListItem,
  ListItemText,
  Alert
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Visibility as VisibilityIcon,
  PictureAsPdf as PdfIcon,
  Download as DownloadIcon,
  Refresh as RefreshIcon,
  GetApp as GetAppIcon
} from '@mui/icons-material';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import api from '../services/api';

interface ConversationData {
  id: string;
  client: {
    name?: string;
    phone: string;
    email?: string;
  };
  state: string;
  startTime: string;
  lastActivity: string;
  urgency?: string;
  botId: string;
  botName: string;
  triageAnalysis?: any;
}

interface ReportsProps {}

const Reports: React.FC<ReportsProps> = () => {
  const [conversations, setConversations] = useState<ConversationData[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ConversationData | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadConversations = async () => {
    setLoading(true);
    try {
      const response = await api.get('/admin/triages');
      if (response.data.triages) {
        setConversations(response.data.triages);
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
    // Refresh every 30 seconds
    const interval = setInterval(loadConversations, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleViewDetails = (conversation: ConversationData) => {
    setSelectedConversation(conversation);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedConversation(null);
  };

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'alta': return 'error';
      case 'media': return 'warning';
      case 'baixa': return 'success';
      default: return 'default';
    }
  };

  const getStateLabel = (state: string) => {
    const stateLabels: { [key: string]: string } = {
      'GREETING': 'Saudação',
      'COLLECTING_NAME': 'Coletando Nome',
      'COLLECTING_EMAIL': 'Coletando Email',
      'ANALYZING_CASE': 'Analisando Caso',
      'COLLECTING_DETAILS': 'Coletando Detalhes',
      'COLLECTING_DOCUMENTS': 'Coletando Documentos',
      'AWAITING_LAWYER': 'Aguardando Advogado',
      'COMPLETED': 'Concluído'
    };
    return stateLabels[state] || state;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('pt-BR');
  };

  const exportReport = () => {
    const csvContent = [
      ['Data', 'Cliente', 'Telefone', 'Estado', 'Urgência', 'Bot', 'Categoria'].join(','),
      ...conversations.map(conv => [
        formatDate(conv.startTime),
        conv.client.name || 'N/A',
        conv.client.phone,
        getStateLabel(conv.state),
        conv.urgency || 'N/A',
        conv.botName,
        conv.triageAnalysis?.case?.category || 'N/A'
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio_conversas_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const exportToPDF = (conversation?: ConversationData) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const margin = 20;
    const lineHeight = 6;
    const maxWidth = pageWidth - 2 * margin;
    let yPos = 30;
    
    // Helper function to add new page if needed
    const checkPageBreak = (requiredHeight: number) => {
      if (yPos + requiredHeight > pageHeight - margin) {
        doc.addPage();
        yPos = margin;
      }
    };
    
    // Helper function to add wrapped text
    const addWrappedText = (text: string, fontSize: number, fontStyle: string = 'normal') => {
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', fontStyle);
      
      const lines = doc.splitTextToSize(text, maxWidth);
      const requiredHeight = lines.length * lineHeight;
      
      checkPageBreak(requiredHeight);
      
      doc.text(lines, margin, yPos);
      yPos += requiredHeight + 3;
    };
    
    // Add title
    addWrappedText('RELATÓRIO DE TRIAGEM JURÍDICA', 18, 'bold');
    yPos += 5;
    
    if (conversation) {
      // Single conversation report
      addWrappedText('DADOS DO CLIENTE', 14, 'bold');
      addWrappedText(`Nome: ${conversation.client.name || 'N/A'}`, 11);
      addWrappedText(`WhatsApp: ${conversation.client.phone}`, 11);
      addWrappedText(`Email: ${conversation.client.email || 'N/A'}`, 11);
      addWrappedText(`Data da Conversa: ${new Date(conversation.startTime).toLocaleString('pt-BR')}`, 11);
      
      yPos += 5;
      
      if (conversation.triageAnalysis) {
        const analysis = conversation.triageAnalysis;
        
        // Case details
        addWrappedText('DETALHES DO CASO', 14, 'bold');
        
        if (analysis.case?.category) {
          addWrappedText(`Categoria: ${analysis.case.category}`, 11);
        }
        
        if (analysis.case?.urgency) {
          addWrappedText(`Urgência: ${analysis.case.urgency.toUpperCase()}`, 11);
        }
        
        if (analysis.case?.date) {
          addWrappedText(`Data do Caso: ${analysis.case.date}`, 11);
        }
        
        if (analysis.triage?.confidence) {
          addWrappedText(`Confiança da Análise: ${(analysis.triage.confidence * 100).toFixed(1)}%`, 11);
        }
        
        if (analysis.case?.description) {
          yPos += 3;
          addWrappedText('Descrição do Caso:', 12, 'bold');
          addWrappedText(analysis.case.description, 10);
        }
        
        if (analysis.case?.documents && analysis.case.documents.length > 0) {
          yPos += 3;
          addWrappedText('Documentos Mencionados:', 12, 'bold');
          analysis.case.documents.forEach((doc: string) => {
            addWrappedText(`• ${doc}`, 10);
          });
        }
        
        // Legal solution
        if (analysis.legal_solution) {
          yPos += 5;
          addWrappedText('ANÁLISE JURÍDICA', 14, 'bold');
          
          const solution = analysis.legal_solution;
          
          if (solution.summary) {
            addWrappedText('Resumo Legal:', 12, 'bold');
            addWrappedText(solution.summary, 10);
            yPos += 3;
          }
          
          if (solution.legal_basis) {
            addWrappedText('Base Legal:', 12, 'bold');
            addWrappedText(solution.legal_basis, 10);
            yPos += 3;
          }
          
          if (solution.success_probability) {
            addWrappedText('Probabilidade de Sucesso:', 12, 'bold');
            addWrappedText(solution.success_probability, 10);
            yPos += 3;
          }
          
          if (solution.recommended_actions) {
            addWrappedText('Ações Recomendadas:', 12, 'bold');
            addWrappedText(solution.recommended_actions, 10);
            yPos += 3;
          }
          
          if (solution.timeline) {
            addWrappedText('Cronograma:', 12, 'bold');
            addWrappedText(solution.timeline, 10);
            yPos += 3;
          }
          
          if (solution.estimated_costs) {
            addWrappedText('Custos Estimados:', 12, 'bold');
            addWrappedText(solution.estimated_costs, 10);
            yPos += 3;
          }
          
          if (solution.required_documents) {
            addWrappedText('Documentos Necessários:', 12, 'bold');
            addWrappedText(solution.required_documents, 10);
            yPos += 3;
          }
          
          if (solution.risks_and_alternatives) {
            addWrappedText('Riscos e Alternativas:', 12, 'bold');
            addWrappedText(solution.risks_and_alternatives, 10);
          }
        }
        
        // Triage information
        if (analysis.triage) {
          yPos += 5;
          addWrappedText('INFORMAÇÕES DE TRIAGEM', 14, 'bold');
          
          addWrappedText(`Escalação Necessária: ${analysis.triage.escalate ? 'Sim' : 'Não'}`, 11);
          
          if (analysis.triage.recommended_action) {
            addWrappedText('Ação Recomendada:', 12, 'bold');
            addWrappedText(analysis.triage.recommended_action, 10);
          }
          
          if (analysis.triage.flags && analysis.triage.flags.length > 0) {
            addWrappedText('Flags:', 12, 'bold');
            addWrappedText(analysis.triage.flags.join(', '), 10);
          }
        }
      }
      
      // Add footer
      checkPageBreak(20);
      yPos = pageHeight - margin - 10;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, margin, yPos);
      doc.text('BriseWare - Sistema de Triagem Jurídica', pageWidth - margin - 80, yPos);
      
      doc.save(`relatorio-${(conversation.client.name || 'cliente').replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`);
    } else {
      // Multiple conversations summary
      addWrappedText('RELATÓRIO GERAL DE CONVERSAS', 16, 'bold');
      addWrappedText(`Total de conversas analisadas: ${conversations.length}`, 12);
      addWrappedText(`Data de geração: ${new Date().toLocaleString('pt-BR')}`, 12);
      
      yPos += 10;
      
      // Summary statistics
      addWrappedText('ESTATÍSTICAS GERAIS', 14, 'bold');
      addWrappedText(`Total de Conversas: ${conversations.length}`, 11);
      addWrappedText(`Urgência Alta: ${conversations.filter(c => c.urgency === 'alta').length}`, 11);
      addWrappedText(`Em Andamento: ${conversations.filter(c => c.state !== 'COMPLETED').length}`, 11);
      addWrappedText(`Concluídas: ${conversations.filter(c => c.state === 'COMPLETED').length}`, 11);
      
      yPos += 10;
      
      // Table header
      addWrappedText('LISTA DETALHADA DE CONVERSAS', 14, 'bold');
      
      // Create table data
      const tableData = conversations.map(conv => [
        conv.client.name || 'N/A',
        conv.client.phone,
        conv.triageAnalysis?.case?.category || 'N/A',
        conv.triageAnalysis?.case?.urgency || 'N/A',
        new Date(conv.startTime).toLocaleDateString('pt-BR')
      ]);
      
      // Use autoTable for better formatting
      (doc as any).autoTable({
        head: [['Cliente', 'WhatsApp', 'Categoria', 'Urgência', 'Data']],
        body: tableData,
        startY: yPos,
        styles: { 
          fontSize: 9,
          cellPadding: 3,
        },
        headStyles: { 
          fillColor: [37, 211, 102],
          textColor: [255, 255, 255],
          fontStyle: 'bold'
        },
        columnStyles: {
          0: { cellWidth: 35 },
          1: { cellWidth: 35 },
          2: { cellWidth: 35 },
          3: { cellWidth: 20 },
          4: { cellWidth: 25 }
        },
        margin: { left: margin, right: margin },
        didDrawPage: function(data: any) {
          // Add footer to each page
          const pageCount = doc.getNumberOfPages();
          const currentPage = data.pageNumber;
          
          doc.setFontSize(8);
          doc.text(`Página ${currentPage} de ${pageCount}`, pageWidth - margin - 30, pageHeight - 10);
          doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, margin, pageHeight - 10);
        }
      });
      
      doc.save(`relatorio-geral-${new Date().toISOString().split('T')[0]}.pdf`);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">
          📊 Relatórios Detalhados
        </Typography>
        <Box>
          <Tooltip title="Atualizar">
            <IconButton onClick={loadConversations} color="primary">
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <Button
            variant="contained"
            startIcon={<GetAppIcon />}
            onClick={exportReport}
            sx={{ ml: 1 }}
          >
            Exportar CSV
          </Button>
          <Button
            variant="outlined"
            startIcon={<PdfIcon />}
            onClick={() => exportToPDF()}
            sx={{ ml: 1 }}
            color="error"
          >
            Exportar PDF
          </Button>
        </Box>
      </Box>

      {/* Summary Cards */}
      <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr 1fr' }} gap={3} mb={4}>
        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Total de Conversas
            </Typography>
            <Typography variant="h4">
              {conversations.length}
            </Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Urgência Alta
            </Typography>
            <Typography variant="h4" color="error">
              {conversations.filter(c => c.urgency === 'alta').length}
            </Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Em Andamento
            </Typography>
            <Typography variant="h4" color="warning.main">
              {conversations.filter(c => c.state !== 'COMPLETED').length}
            </Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Concluídas
            </Typography>
            <Typography variant="h4" color="success.main">
              {conversations.filter(c => c.state === 'COMPLETED').length}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Conversations Table */}
      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Data/Hora</TableCell>
                <TableCell>Cliente</TableCell>
                <TableCell>Telefone</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell>Urgência</TableCell>
                <TableCell>Bot</TableCell>
                <TableCell>Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {conversations.map((conversation) => (
                <TableRow key={conversation.id}>
                  <TableCell>
                    {formatDate(conversation.startTime)}
                  </TableCell>
                  <TableCell>
                    {conversation.client.name || 'N/A'}
                  </TableCell>
                  <TableCell>
                    {conversation.client.phone}
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={getStateLabel(conversation.state)}
                      size="small"
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={conversation.urgency || 'N/A'}
                      color={getUrgencyColor(conversation.urgency || '')}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    {conversation.botName}
                  </TableCell>
                  <TableCell>
                    <Tooltip title="Ver Detalhes">
                      <IconButton 
                        size="small" 
                        onClick={() => handleViewDetails(conversation)}
                      >
                        <VisibilityIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Exportar PDF">
                      <IconButton 
                        size="small" 
                        onClick={() => exportToPDF(conversation)}
                        color="primary"
                      >
                        <PdfIcon />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Details Dialog */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>
          Detalhes da Conversa
        </DialogTitle>
        <DialogContent>
          {selectedConversation && (
            <Box>
              {/* Client Information */}
              <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">👤 Informações do Cliente</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr 1fr' }} gap={2}>
                    <Box>
                      <Typography><strong>Nome:</strong> {selectedConversation.client.name || 'N/A'}</Typography>
                    </Box>
                    <Box>
                      <Typography><strong>Telefone:</strong> {selectedConversation.client.phone}</Typography>
                    </Box>
                    <Box>
                      <Typography><strong>Email:</strong> {selectedConversation.client.email || 'N/A'}</Typography>
                    </Box>
                    <Box>
                      <Typography><strong>Estado:</strong> {getStateLabel(selectedConversation.state)}</Typography>
                    </Box>
                  </Box>
                </AccordionDetails>
              </Accordion>

              {/* Legal Analysis */}
              {selectedConversation.triageAnalysis ? (
                <>
                  <Accordion defaultExpanded>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="h6">📋 Detalhes do Caso</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr 1fr' }} gap={2}>
                        <Box>
                          <Typography variant="subtitle2" color="textSecondary">Categoria</Typography>
                          <Typography variant="body1" gutterBottom>
                            {selectedConversation.triageAnalysis.case?.category || 'N/A'}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="subtitle2" color="textSecondary">Urgência</Typography>
                          <Chip 
                            label={selectedConversation.triageAnalysis.case?.urgency || 'N/A'} 
                            color={selectedConversation.triageAnalysis.case?.urgency === 'alta' ? 'error' : 'default'}
                            size="small"
                          />
                        </Box>
                        <Box>
                          <Typography variant="subtitle2" color="textSecondary">Data do Caso</Typography>
                          <Typography variant="body1">
                            {selectedConversation.triageAnalysis.case?.date || 'N/A'}
                          </Typography>
                        </Box>
                        <Box>
                          <Typography variant="subtitle2" color="textSecondary">Confiança da Análise</Typography>
                          <Typography variant="body1">
                            {selectedConversation.triageAnalysis.triage?.confidence ? 
                              `${(selectedConversation.triageAnalysis.triage.confidence * 100).toFixed(1)}%` : 'N/A'}
                          </Typography>
                        </Box>
                        <Box sx={{ gridColumn: '1 / -1' }}>
                          <Typography variant="subtitle2" color="textSecondary">Descrição do Caso</Typography>
                          <Typography variant="body2" style={{ whiteSpace: 'pre-wrap' }}>
                            {selectedConversation.triageAnalysis.case?.description || 'N/A'}
                          </Typography>
                        </Box>
                        {selectedConversation.triageAnalysis.case?.documents && (
                          <Box sx={{ gridColumn: '1 / -1' }}>
                            <Typography variant="subtitle2" color="textSecondary">Documentos Mencionados</Typography>
                            <List dense>
                              {selectedConversation.triageAnalysis.case.documents.map((doc: string, index: number) => (
                                <ListItem key={index}>
                                  <ListItemText primary={`• ${doc}`} />
                                </ListItem>
                              ))}
                            </List>
                          </Box>
                        )}
                      </Box>
                    </AccordionDetails>
                  </Accordion>

                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="h6">⚖️ Análise Jurídica Detalhada</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      {selectedConversation.triageAnalysis.legal_solution ? (
                        <Box>
                          <Typography variant="subtitle1" gutterBottom>
                            <strong>Resumo Legal:</strong>
                          </Typography>
                          <Typography variant="body2" paragraph style={{ whiteSpace: 'pre-wrap' }}>
                            {selectedConversation.triageAnalysis.legal_solution.summary}
                          </Typography>

                          <Divider sx={{ my: 2 }} />

                          <Typography variant="subtitle1" gutterBottom>
                            <strong>Base Legal:</strong>
                          </Typography>
                          <Typography variant="body2" paragraph style={{ whiteSpace: 'pre-wrap' }}>
                            {selectedConversation.triageAnalysis.legal_solution.legal_basis}
                          </Typography>

                          <Divider sx={{ my: 2 }} />

                          <Typography variant="subtitle1" gutterBottom>
                            <strong>Probabilidade de Sucesso:</strong>
                          </Typography>
                          <Typography variant="body2" paragraph>
                            {selectedConversation.triageAnalysis.legal_solution.success_probability}
                          </Typography>

                          {selectedConversation.triageAnalysis.legal_solution.recommended_actions && (
                            <>
                              <Divider sx={{ my: 2 }} />
                              <Typography variant="subtitle1" gutterBottom>
                                <strong>Ações Recomendadas:</strong>
                              </Typography>
                              <Typography variant="body2" paragraph style={{ whiteSpace: 'pre-wrap' }}>
                                {selectedConversation.triageAnalysis.legal_solution.recommended_actions}
                              </Typography>
                            </>
                          )}

                          {selectedConversation.triageAnalysis.legal_solution.timeline && (
                            <>
                              <Divider sx={{ my: 2 }} />
                              <Typography variant="subtitle1" gutterBottom>
                                <strong>Cronograma:</strong>
                              </Typography>
                              <Typography variant="body2" paragraph style={{ whiteSpace: 'pre-wrap' }}>
                                {selectedConversation.triageAnalysis.legal_solution.timeline}
                              </Typography>
                            </>
                          )}

                          {selectedConversation.triageAnalysis.legal_solution.estimated_costs && (
                            <>
                              <Divider sx={{ my: 2 }} />
                              <Typography variant="subtitle1" gutterBottom>
                                <strong>Custos Estimados:</strong>
                              </Typography>
                              <Typography variant="body2" paragraph style={{ whiteSpace: 'pre-wrap' }}>
                                {selectedConversation.triageAnalysis.legal_solution.estimated_costs}
                              </Typography>
                            </>
                          )}

                          {selectedConversation.triageAnalysis.legal_solution.required_documents && (
                            <>
                              <Divider sx={{ my: 2 }} />
                              <Typography variant="subtitle1" gutterBottom>
                                <strong>Documentos Necessários:</strong>
                              </Typography>
                              <Typography variant="body2" paragraph style={{ whiteSpace: 'pre-wrap' }}>
                                {selectedConversation.triageAnalysis.legal_solution.required_documents}
                              </Typography>
                            </>
                          )}

                          {selectedConversation.triageAnalysis.legal_solution.risks_and_alternatives && (
                            <>
                              <Divider sx={{ my: 2 }} />
                              <Typography variant="subtitle1" gutterBottom>
                                <strong>Riscos e Alternativas:</strong>
                              </Typography>
                              <Typography variant="body2" paragraph style={{ whiteSpace: 'pre-wrap' }}>
                                {selectedConversation.triageAnalysis.legal_solution.risks_and_alternatives}
                              </Typography>
                            </>
                          )}
                        </Box>
                      ) : (
                        <Alert severity="info">
                          Análise jurídica não disponível para esta conversa.
                        </Alert>
                      )}
                    </AccordionDetails>
                  </Accordion>

                  <Accordion>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Typography variant="h6">🎯 Informações de Triagem</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr 1fr' }} gap={2}>
                        <Box>
                          <Typography variant="subtitle2" color="textSecondary">Escalação Necessária</Typography>
                          <Chip 
                            label={selectedConversation.triageAnalysis.triage?.escalate ? 'Sim' : 'Não'} 
                            color={selectedConversation.triageAnalysis.triage?.escalate ? 'warning' : 'success'}
                            size="small"
                          />
                        </Box>
                        <Box>
                          <Typography variant="subtitle2" color="textSecondary">Ação Recomendada</Typography>
                          <Typography variant="body2">
                            {selectedConversation.triageAnalysis.triage?.recommended_action || 'N/A'}
                          </Typography>
                        </Box>
                        {selectedConversation.triageAnalysis.triage?.flags && (
                          <Box sx={{ gridColumn: '1 / -1' }}>
                            <Typography variant="subtitle2" color="textSecondary">Flags</Typography>
                            <Box display="flex" flexWrap="wrap" gap={1} mt={1}>
                              {selectedConversation.triageAnalysis.triage.flags.map((flag: string, index: number) => (
                                <Chip key={index} label={flag} size="small" variant="outlined" />
                              ))}
                            </Box>
                          </Box>
                        )}
                      </Box>
                    </AccordionDetails>
                  </Accordion>
                </>
              ) : (
                <Alert severity="warning">
                  Nenhuma análise de triagem disponível para esta conversa.
                </Alert>
              )}

              {/* Timeline */}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="h6">📅 Timeline</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Typography><strong>Início:</strong> {formatDate(selectedConversation.startTime)}</Typography>
                  <Typography><strong>Última Atividade:</strong> {formatDate(selectedConversation.lastActivity)}</Typography>
                  <Typography><strong>Bot:</strong> {selectedConversation.botName}</Typography>
                </AccordionDetails>
              </Accordion>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button 
            startIcon={<PdfIcon />} 
            onClick={() => selectedConversation && exportToPDF(selectedConversation)}
            color="error"
            variant="outlined"
          >
            Exportar PDF
          </Button>
          <Button onClick={handleCloseDialog}>Fechar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Reports;
