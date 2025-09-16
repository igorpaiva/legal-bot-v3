import React, { useState, useEffect, useCallback } from 'react';
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
  Divider,
  List,
  ListItem,
  ListItemText,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  SelectChangeEvent
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  Visibility as VisibilityIcon,
  PictureAsPdf as PdfIcon,
  Refresh as RefreshIcon,
  GetApp as GetAppIcon
} from '@mui/icons-material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts';
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
  triageAnalysis?: any;
  botName: string;
}

interface ReportsProps {}

const legalFields = [
  'Trabalhista',
  'Civil', 
  'Penal',
  'Empresarial',
  'Tributário',
  'Administrativo',
  'Constitucional',
  'Família',
  'Consumidor',
  'Imobiliário',
  'Previdenciário',
  'Internacional',
  'Outros'
];

const Reports: React.FC<ReportsProps> = () => {
  const [conversations, setConversations] = useState<ConversationData[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ConversationData | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [legalFieldFilter, setLegalFieldFilter] = useState<string>('all');
  const [useMockData, setUseMockData] = useState(false);
  const [chartExpanded, setChartExpanded] = useState(true);

  const generateMockData = (): ConversationData[] => {
    const mockConversations: ConversationData[] = [];
    const names = ['Maria Silva', 'João Santos', 'Ana Costa', 'Pedro Oliveira', 'Carla Mendes', 'Paulo Lima', 'Fernanda Rocha', 'Ricardo Almeida'];
    const states = ['COMPLETED', 'ANALYZING_CASE', 'COLLECTING_DETAILS', 'AWAITING_LAWYER'];
    
    for (let i = 0; i < 50; i++) {
      const randomName = names[Math.floor(Math.random() * names.length)];
      const randomState = states[Math.floor(Math.random() * states.length)];
      const randomLegalField = legalFields[Math.floor(Math.random() * legalFields.length)];
      
      mockConversations.push({
        id: `mock-${i}`,
        client: {
          name: randomName,
          phone: `+55119${Math.floor(10000000 + Math.random() * 90000000)}`,
          email: `${randomName.toLowerCase().replace(' ', '.')}@email.com`
        },
        state: randomState,
        startTime: new Date(Date.now() - Math.floor(Math.random() * 30) * 24 * 60 * 60 * 1000).toISOString(),
        botName: 'Legal Bot',
        triageAnalysis: {
          case: {
            category: randomLegalField,
            description: `Consulta sobre ${randomLegalField.toLowerCase()}`
          }
        }
      });
    }
    return mockConversations;
  };

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      if (useMockData) {
        // Use mock data immediately
        setConversations(generateMockData());
      } else {
        // Load real data from API
        const response = await api.get('/admin/triages');
        if (response.data.triages) {
          setConversations(response.data.triages);
        }
      }
    } catch (error) {
      console.error('Error loading conversations:', error);
    } finally {
      setLoading(false);
    }
  }, [useMockData]);

  useEffect(() => {
    loadConversations();
    // Refresh every 30 seconds only when using real data
    if (!useMockData) {
      const interval = setInterval(loadConversations, 30000);
      return () => clearInterval(interval);
    }
  }, [useMockData, loadConversations]);

  const handleViewDetails = (conversation: ConversationData) => {
    setSelectedConversation(conversation);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedConversation(null);
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
      ['Data', 'Cliente', 'Telefone', 'Estado', 'Área Jurídica', 'Bot'].join(','),
      ...filteredConversations.map(conv => [
        formatDate(conv.startTime),
        conv.client.name || 'N/A',
        conv.client.phone,
        getStateLabel(conv.state),
        conv.triageAnalysis?.case?.category || 'Outros',
        conv.botName
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio_conversas_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const exportToPDF = async (conversation?: ConversationData) => {
    try {
      let url: string;
      let filename: string;
      
      if (conversation) {
        // Se o id for no formato "conversaId-triageId", extrai só o id da conversa
        let conversationId = conversation.id;
        if (conversationId.includes('-')) {
          conversationId = conversationId.split('-')[0];
        }
        url = `/api/pdf/conversation/${conversationId}`;
        filename = `relatorio-${(conversation.client.name || 'cliente').replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`;
      } else {
        // Summary PDF
        url = `/api/pdf/summary`;
        filename = `relatorio-geral-${new Date().toISOString().split('T')[0]}.pdf`;
      }
      
      // Create a temporary link to download the PDF
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to generate PDF');
      }
      
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Erro ao gerar PDF. Tente novamente.');
    }
  };

  // Filter conversations by legal field
  const filteredConversations = legalFieldFilter === 'all' 
    ? conversations 
    : conversations.filter(conv => 
        (conv.triageAnalysis?.case?.category || 'Outros') === legalFieldFilter
      );

  // Prepare chart data for legal fields distribution
  const chartData = legalFields.map((field) => {
    const count = conversations.filter(c => 
      (c.triageAnalysis?.case?.category || 'Outros') === field
    ).length;
    return {
      name: field,
      count: count
    };
  }).filter(item => item.count > 0); // Only show fields with data

  // Colors for the chart bars
  const chartColors = [
    '#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#ff0000',
    '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
    '#800080', '#ffa500', '#a52a2a'
  ];

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
          <Button
            variant={useMockData ? "contained" : "outlined"}
            onClick={() => setUseMockData(!useMockData)}
            sx={{ mr: 1 }}
            color={useMockData ? "secondary" : "primary"}
          >
            {useMockData ? "Dados Reais" : "Dados Demo"}
          </Button>
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

      {/* Legal Field Filter and Mock Data Indicator */}
      <Box display="flex" alignItems="center" gap={2} mb={3}>
        <FormControl sx={{ minWidth: 200 }}>
          <InputLabel>Filtrar por Área Jurídica</InputLabel>
          <Select
            value={legalFieldFilter}
            label="Filtrar por Área Jurídica"
            onChange={(e: SelectChangeEvent<string>) => setLegalFieldFilter(e.target.value)}
          >
            <MenuItem value="all">Todas as Áreas</MenuItem>
            {legalFields.map((field) => (
              <MenuItem key={field} value={field}>
                {field}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {useMockData && (
          <Chip 
            label="Dados de Demonstração" 
            color="warning" 
            variant="outlined"
          />
        )}
      </Box>

      {/* Summary Cards */}
      <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr 1fr' }} gap={3} mb={4}>
        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Total de Conversas
            </Typography>
            <Typography variant="h4">
              {filteredConversations.length}
            </Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Em Andamento
            </Typography>
            <Typography variant="h4" color="warning.main">
              {filteredConversations.filter(c => c.state !== 'COMPLETED').length}
            </Typography>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Typography color="textSecondary" gutterBottom>
              Concluídas
            </Typography>
            <Typography variant="h4" color="success.main">
              {filteredConversations.filter(c => c.state === 'COMPLETED').length}
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Legal Fields Distribution Chart */}
      {legalFieldFilter === 'all' && chartData.length > 0 && (
        <Box mb={4}>
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
            <Typography variant="h6">
              📊 Distribuição por Área Jurídica
            </Typography>
            <Button
              variant="outlined"
              size="small"
              onClick={() => setChartExpanded(!chartExpanded)}
              startIcon={<ExpandMoreIcon sx={{ 
                transform: chartExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.3s ease'
              }} />}
            >
              {chartExpanded ? 'Ocultar' : 'Mostrar'}
            </Button>
          </Box>
          {chartExpanded && (
            <Paper sx={{ p: 3 }}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="name" 
                    angle={-45}
                    textAnchor="end"
                    height={100}
                    fontSize={12}
                  />
                  <YAxis />
                  <RechartsTooltip 
                    formatter={(value) => [value, 'Conversas']}
                    labelFormatter={(label) => `Área: ${label}`}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Paper>
          )}
        </Box>
      )}

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
                <TableCell>Área Jurídica</TableCell>
                <TableCell>Bot</TableCell>
                <TableCell>Ações</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredConversations.map((conversation) => (
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
                      label={conversation.triageAnalysis?.case?.category || 'Outros'}
                      size="small"
                      variant="filled"
                      color="primary"
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
