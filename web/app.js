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
const zoomInButton = document.getElementById('zoomIn');
const zoomOutButton = document.getElementById('zoomOut');
const zoomResetButton = document.getElementById('zoomReset');
const zoomValue = document.getElementById('zoomValue');
const datasetInfo = document.getElementById('datasetInfo');
const listContainer = document.getElementById('simpleList');
const chartSelect = document.getElementById('chartType');

let currentData = null;

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

  const movieIds = new Set();
  const linkKeys = new Set();
  const addLink = (source, target, type) => {
    const key = `${source}|${target}|${type}`;
    if (linkKeys.has(key)) return;
    linkKeys.add(key);
    links.push({ source, target, type });
  };

  data.movies.forEach((movie) => {
    if (movieIds.has(movie.id)) return;
    movieIds.add(movie.id);

    const movieNode = ensureNode(`movie-${movie.id}`, movie.title, 'movie', {
      releaseDate: movie.release_date,
      runtime: movie.runtime,
    });

    movie.genres.forEach((genre) => {
      const genreNode = ensureNode(`genre-${genre.id}`, genre.name, 'genre');
      addLink(movieNode.id, genreNode.id, 'genre');
    });

    movie.cast.forEach((person) => {
      const personNode = ensureNode(`person-${person.id}`, person.name, 'person');
      addLink(movieNode.id, personNode.id, 'cast');
    });

    (movie.keywords ?? []).forEach((keyword) => {
      const keywordNode = ensureNode(`keyword-${keyword.id}`, keyword.name, 'keyword');
      addLink(movieNode.id, keywordNode.id, 'keyword');
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
  svg.style('display', 'block');

  const svgNode = svg.node();
  const svgRect = svgNode?.getBoundingClientRect();
  const layoutWidth = svgRect?.width || width;
  const layoutHeight = svgRect?.height || height;

  const zoomLayer = svg.append('g').attr('class', 'zoom-layer');
  const linkGroup = zoomLayer.append('g');
  const nodeGroup = zoomLayer.append('g');
  const labelGroup = zoomLayer.append('g');

  const minZoom = 0.01;
  const maxZoom = 1;
  const fitMaxZoom = 0.85;
  const updateZoomValue = (scale) => {
    if (!zoomValue) return;
    const percent = Math.round(scale * 100);
    zoomValue.textContent = `${percent}%`;
  };

  const zoom = d3
    .zoom()
    .scaleExtent([minZoom, maxZoom])
    .on('zoom', (event) => {
      zoomLayer.attr('transform', event.transform);
      updateZoomValue(event.transform.k);
    });

  svg.call(zoom);

  const simulation = d3
    .forceSimulation(graph.nodes)
    .force('link', d3.forceLink(graph.links).id((d) => d.id).strength(0.1))
    .force('charge', d3.forceManyBody().strength(-80))
    .force('center', d3.forceCenter(layoutWidth / 2, layoutHeight / 2))
    .force('x', d3.forceX(layoutWidth / 2).strength(0.08))
    .force('y', d3.forceY(layoutHeight / 2).strength(0.08))
    .force('collide', d3.forceCollide().radius(22));

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

  const updateZoomToFit = () => {
    const bounds = zoomLayer.node().getBBox();
    if (!bounds.width || !bounds.height) return;

    const padding = 60;
    const viewWidth = svgRect?.width || width;
    const viewHeight = svgRect?.height || height;
    const scale = Math.min(
      fitMaxZoom,
      Math.max(
        minZoom,
        Math.min(
          viewWidth / (bounds.width + padding),
          viewHeight / (bounds.height + padding),
        ),
      ),
    );
    const translateX = viewWidth / 2 - (bounds.x + bounds.width / 2) * scale;
    const translateY = viewHeight / 2 - (bounds.y + bounds.height / 2) * scale;
    const transform = d3.zoomIdentity.translate(translateX, translateY).scale(scale);
    svg.call(zoom.transform, transform);
  };

  simulation.on('tick', () => {
    link
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);

    node.attr('cx', (d) => d.x).attr('cy', (d) => d.y);

    label.attr('x', (d) => d.x + 10).attr('y', (d) => d.y + 4);
  });

  simulation.on('end', updateZoomToFit);

  const zoomBy = (factor) => {
    svg.transition().duration(200).call(zoom.scaleBy, factor);
  };

  zoomInButton.onclick = () => zoomBy(1.2);
  zoomOutButton.onclick = () => zoomBy(0.8);
  zoomResetButton.onclick = updateZoomToFit;

  const updateFilter = () => {
    const filterValue = filterInput.value;
    node.attr('opacity', (d) => (d.type === filterValue ? 1 : 0));
    label.attr('opacity', (d) => (d.type === filterValue ? 1 : 0));
    link.attr('opacity', (d) => {
      return d.source.type === filterValue && d.target.type === filterValue ? 0.6 : 0;
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
  updateZoomToFit();
};

const getSvgSize = () => {
  const rect = svg.node()?.getBoundingClientRect();
  return {
    width: rect?.width || width,
    height: rect?.height || height,
  };
};

const renderList = (data) => {
  if (!listContainer) return;
  listContainer.innerHTML = '';
  listContainer.style.display = 'grid';
  svg.style('display', 'none');

  const heading = document.createElement('h3');
  heading.textContent = 'Filmliste (Runtime)';
  listContainer.appendChild(heading);

  const list = document.createElement('ul');
  data.movies.forEach((movie) => {
    const item = document.createElement('li');
    const title = document.createElement('span');
    title.textContent = movie.title;
    const runtime = document.createElement('span');
    runtime.className = 'runtime';
    runtime.textContent = movie.runtime ? `${movie.runtime} min` : 'n/a';
    item.appendChild(title);
    item.appendChild(runtime);
    list.appendChild(item);
  });
  listContainer.appendChild(list);
};

const styleAxis = (axisGroup) => {
  axisGroup.selectAll('path, line').attr('stroke', '#475569');
  axisGroup.selectAll('text').attr('fill', '#cbd5f5');
};

const renderGenresBar = (data) => {
  if (listContainer) {
    listContainer.style.display = 'none';
  }
  svg.style('display', 'block');
  svg.selectAll('*').remove();

  const { width: viewWidth, height: viewHeight } = getSvgSize();
  const margin = { top: 50, right: 40, bottom: 120, left: 60 };
  const chartWidth = viewWidth - margin.left - margin.right;
  const chartHeight = viewHeight - margin.top - margin.bottom;

  const genreCounts = new Map();
  data.movies.forEach((movie) => {
    (movie.genres ?? []).forEach((genre) => {
      genreCounts.set(genre.name, (genreCounts.get(genre.name) ?? 0) + 1);
    });
  });

  const dataset = Array.from(genreCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const x = d3
    .scaleBand()
    .domain(dataset.map((d) => d.name))
    .range([0, chartWidth])
    .padding(0.2);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(dataset, (d) => d.count) ?? 1])
    .nice()
    .range([chartHeight, 0]);

  const chart = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  chart
    .append('text')
    .attr('x', 0)
    .attr('y', -20)
    .attr('fill', '#e2e8f0')
    .attr('font-size', 16)
    .text('Genre-Haeufigkeit');

  chart
    .selectAll('rect')
    .data(dataset)
    .enter()
    .append('rect')
    .attr('x', (d) => x(d.name))
    .attr('y', (d) => y(d.count))
    .attr('width', x.bandwidth())
    .attr('height', (d) => chartHeight - y(d.count))
    .attr('fill', '#38bdf8');

  const xAxis = chart
    .append('g')
    .attr('transform', `translate(0,${chartHeight})`)
    .call(d3.axisBottom(x));

  xAxis
    .selectAll('text')
    .attr('text-anchor', 'end')
    .attr('transform', 'rotate(-35)')
    .attr('dx', '-0.6em')
    .attr('dy', '0.25em');
  styleAxis(xAxis);

  const yAxis = chart.append('g').call(d3.axisLeft(y).ticks(6));
  styleAxis(yAxis);

  chart
    .append('text')
    .attr('x', chartWidth / 2)
    .attr('y', chartHeight + 90)
    .attr('text-anchor', 'middle')
    .attr('fill', '#cbd5f5')
    .attr('font-size', 12)
    .text('Genre');

  chart
    .append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -chartHeight / 2)
    .attr('y', -45)
    .attr('text-anchor', 'middle')
    .attr('fill', '#cbd5f5')
    .attr('font-size', 12)
    .text('Anzahl Filme');
};

const renderReleaseRuntimeScatter = (data) => {
  if (listContainer) {
    listContainer.style.display = 'none';
  }
  svg.style('display', 'block');
  svg.selectAll('*').remove();

  const { width: viewWidth, height: viewHeight } = getSvgSize();
  const margin = { top: 50, right: 40, bottom: 60, left: 70 };
  const chartWidth = viewWidth - margin.left - margin.right;
  const chartHeight = viewHeight - margin.top - margin.bottom;

  const dataset = data.movies
    .map((movie) => {
      const year = Number(movie.release_date?.slice(0, 4));
      return { title: movie.title, year, runtime: movie.runtime };
    })
    .filter((movie) => Number.isFinite(movie.year) && movie.runtime > 0);

  const yearExtent = d3.extent(dataset, (d) => d.year);
  const runtimeMax = d3.max(dataset, (d) => d.runtime) ?? 1;

  const x = d3
    .scaleLinear()
    .domain(yearExtent[0] ? yearExtent : [2000, 2030])
    .nice()
    .range([0, chartWidth]);
  const y = d3.scaleLinear().domain([0, runtimeMax]).nice().range([chartHeight, 0]);

  const chart = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  chart
    .append('text')
    .attr('x', 0)
    .attr('y', -20)
    .attr('fill', '#e2e8f0')
    .attr('font-size', 16)
    .text('Release-Jahr vs. Runtime');

  chart
    .selectAll('circle')
    .data(dataset)
    .enter()
    .append('circle')
    .attr('cx', (d) => x(d.year))
    .attr('cy', (d) => y(d.runtime))
    .attr('r', 4)
    .attr('fill', '#22c55e')
    .attr('opacity', 0.8);

  const xAxis = chart
    .append('g')
    .attr('transform', `translate(0,${chartHeight})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format('d')));
  styleAxis(xAxis);

  const yAxis = chart.append('g').call(d3.axisLeft(y).ticks(6));
  styleAxis(yAxis);

  chart
    .append('text')
    .attr('x', chartWidth / 2)
    .attr('y', chartHeight + 45)
    .attr('text-anchor', 'middle')
    .attr('fill', '#cbd5f5')
    .attr('font-size', 12)
    .text('Release-Jahr');

  chart
    .append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -chartHeight / 2)
    .attr('y', -50)
    .attr('text-anchor', 'middle')
    .attr('fill', '#cbd5f5')
    .attr('font-size', 12)
    .text('Runtime (Minuten)');
};

const renderChart = (data) => {
  const mode = chartSelect?.value ?? 'list';
  if (mode === 'genres') {
    renderGenresBar(data);
    return;
  }
  if (mode === 'scatter') {
    renderReleaseRuntimeScatter(data);
    return;
  }
  if (mode === 'force') {
    if (listContainer) {
      listContainer.style.display = 'none';
    }
    const graph = createGraph(data);
    renderNetwork(graph);
    return;
  }
  renderList(data);
};

if (chartSelect) {
  chartSelect.addEventListener('change', () => {
    if (currentData) {
      renderChart(currentData);
    }
  });
}

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
    currentData = data;
    renderChart(data);
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
    currentData = data;
    renderChart(data);
  } catch (error) {
    datasetInfo.textContent = 'Konnte JSON nicht laden. Bitte Datei prüfen.';
    console.error(error);
  }
});
