const colorMap = {
  movie: '#38bdf8',
  genre: '#a855f7',
  person: '#22c55e',
  keyword: '#f97316',
};

const svg = d3.select('#network');
const width = 1200;
const height = 800;

const linkStrengthInput = document.getElementById('linkStrength');
const filterInput = document.getElementById('nodeFilter');
const jsonFileInput = document.getElementById('jsonFile');
const datasetInfo = document.getElementById('datasetInfo');

const createGraph = (data) => {
  const nodes = [];
  const links = [];
  const nodeMap = new Map();

  const ensureNode = (id, label, type, meta = {}) => {
    if (nodeMap.has(id)) {
      return nodeMap.get(id);
    }
    const node = {
      id,
      label,
      type,
      ...meta,
    };
    nodeMap.set(id, node);
    nodes.push(node);
    return node;
  };

  data.movies.forEach((movie) => {
    const movieNode = ensureNode(`movie-${movie.id}`, movie.title, 'movie', {
      releaseDate: movie.release_date,
      runtime: movie.runtime,
    });

    movie.genres.forEach((genre) => {
      const genreNode = ensureNode(`genre-${genre.id}`, genre.name, 'genre');
      links.push({ source: movieNode.id, target: genreNode.id, type: 'genre' });
    });

    movie.cast.forEach((person) => {
      const personNode = ensureNode(`person-${person.id}`, person.name, 'person');
      links.push({ source: movieNode.id, target: personNode.id, type: 'cast' });
    });

    movie.keywords.forEach((keyword) => {
      const keywordNode = ensureNode(`keyword-${keyword.id}`, keyword.name, 'keyword');
      links.push({ source: movieNode.id, target: keywordNode.id, type: 'keyword' });
    });
  });

  return { nodes, links };
};

const updateInfo = (data) => {
  const fetchedAt = data.fetched_at ? new Date(data.fetched_at).toLocaleDateString('de-DE') : 'lokal';
  datasetInfo.textContent = `Datensatz: ${data.movies.length} Filme · ${fetchedAt}`;
};

const renderNetwork = (graph) => {
  svg.selectAll('*').remove();

  const linkGroup = svg.append('g');
  const nodeGroup = svg.append('g');
  const labelGroup = svg.append('g');

  const simulation = d3
    .forceSimulation(graph.nodes)
    .force('link', d3.forceLink(graph.links).id((d) => d.id).strength(-0.12))
    .force('charge', d3.forceManyBody().strength(-180))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide().radius(24));

  const link = linkGroup
    .selectAll('line')
    .data(graph.links)
    .enter()
    .append('line')
    .attr('class', 'link');

  const node = nodeGroup
    .selectAll('circle')
    .data(graph.nodes)
    .enter()
    .append('circle')
    .attr('class', 'node')
    .attr('r', (d) => (d.type === 'movie' ? 10 : 7))
    .attr('fill', (d) => colorMap[d.type])
    .call(
      d3
        .drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );

  const label = labelGroup
    .selectAll('text')
    .data(graph.nodes)
    .enter()
    .append('text')
    .attr('class', 'label')
    .text((d) => d.label);

  simulation.on('tick', () => {
    link
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);

    node.attr('cx', (d) => d.x).attr('cy', (d) => d.y);

    label.attr('x', (d) => d.x + 10).attr('y', (d) => d.y + 4);
  });

  const updateFilter = () => {
    const filterValue = filterInput.value;
    node.attr('opacity', (d) => (filterValue === 'all' || d.type === filterValue ? 1 : 0.15));
    label.attr('opacity', (d) => (filterValue === 'all' || d.type === filterValue ? 1 : 0));
    link.attr('opacity', (d) => {
      if (filterValue === 'all') return 0.6;
      return d.source.type === filterValue || d.target.type === filterValue ? 0.6 : 0.1;
    });
  };

  const updateLinkStrength = () => {
    const strength = Number(linkStrengthInput.value) / 1000;
    simulation.force('link').strength(strength);
    simulation.alpha(0.6).restart();
  };

  filterInput.addEventListener('change', updateFilter);
  linkStrengthInput.addEventListener('input', updateLinkStrength);

  updateFilter();
  updateLinkStrength();
};

const loadData = async () => {
  const sources = ['../data/movies.json', '../data/movies.sample.json'];

  for (const source of sources) {
    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error('Request failed');
      return response.json();
    } catch (error) {
      console.warn(`Unable to load ${source}`, error);
    }
  }

  throw new Error('No data available');
};

const loadFromFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        resolve(data);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

loadData()
  .then((data) => {
    updateInfo(data);
    const graph = createGraph(data);
    renderNetwork(graph);
  })
  .catch((error) => {
    datasetInfo.textContent =
      'Keine Daten verfügbar. Bitte JSON-Datei auswählen oder den TMDB-Download ausführen.';
    console.error(error);
  });

jsonFileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const data = await loadFromFile(file);
    updateInfo(data);
    const graph = createGraph(data);
    renderNetwork(graph);
  } catch (error) {
    datasetInfo.textContent = 'Konnte JSON nicht laden. Bitte Datei prüfen.';
    console.error(error);
  }
});
